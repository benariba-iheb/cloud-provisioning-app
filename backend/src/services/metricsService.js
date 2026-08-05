const client = require('prom-client');
const { pool } = require('../db/pool');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'cloud_platform_http_requests_total',
  help: 'Total HTTP requests handled',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'cloud_platform_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const instancesGauge = new client.Gauge({
  name: 'cloud_platform_instances',
  help: 'Number of instances by status',
  labelNames: ['status'],
  registers: [register],
});

const dbPoolTotal = new client.Gauge({
  name: 'cloud_platform_db_pool_total_connections',
  help: 'Total PostgreSQL pool connections (in use + idle)',
  registers: [register],
});
const dbPoolIdle = new client.Gauge({
  name: 'cloud_platform_db_pool_idle_connections',
  help: 'Idle PostgreSQL pool connections',
  registers: [register],
});
const dbPoolWaiting = new client.Gauge({
  name: 'cloud_platform_db_pool_waiting_requests',
  help: 'Queries waiting for a free PostgreSQL pool connection',
  registers: [register],
});

// Route label uses the matched Express route pattern (e.g. "/instances/:id"),
// never req.originalUrl - the latter would put raw UUIDs into a label value,
// producing a fresh time series per request and unbounded cardinality.
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });
  next();
}

// Computed fresh on each scrape rather than incrementally maintained
// alongside instanceService's create/terminate/reap calls - one query here
// can't drift out of sync with the DB the way scattered increment/decrement
// calls could.
async function refreshInstanceMetrics() {
  try {
    const { rows } = await pool.query('SELECT status, COUNT(*) FROM instances GROUP BY status');
    instancesGauge.reset();
    for (const row of rows) {
      instancesGauge.set({ status: row.status }, Number(row.count));
    }
  } catch (err) {
    console.error('Failed to refresh instance metrics', err);
  }
}

function refreshDbPoolMetrics() {
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount);
}

module.exports = { register, metricsMiddleware, refreshInstanceMetrics, refreshDbPoolMetrics };
