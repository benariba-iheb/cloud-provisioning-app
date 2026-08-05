const express = require('express');
const { register, refreshInstanceMetrics, refreshDbPoolMetrics } = require('../services/metricsService');

const router = express.Router();

// Intentionally unauthenticated, like /health and /ready - this is meant to
// be scraped by Prometheus (pod-to-pod, direct to the backend Service),
// which won't carry a browser session cookie. Restricting who can reach
// this is a NetworkPolicy concern for once a monitoring stack actually
// exists on this cluster, not an application-auth one.
router.get('/', async (req, res) => {
  await refreshInstanceMetrics();
  refreshDbPoolMetrics();
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = router;
