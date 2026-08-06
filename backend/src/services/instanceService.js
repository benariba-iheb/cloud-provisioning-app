const crypto = require('crypto');
const { pool } = require('../db/pool');
const k8sService = require('./k8sService');

const MAX_INSTANCES_PER_USER = 3;
const TTL_SECONDS = Number(process.env.INSTANCE_TTL_SECONDS) || 600;
const ACTIVE_STATUSES = ['creating', 'running'];
const DEFAULT_DISTRO = 'ubuntu';

function toApiShape(row) {
  return {
    id: row.id,
    podName: row.pod_name,
    distro: row.distro,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    terminatedAt: row.terminated_at,
  };
}

// Pure mapping: k8s phase + current DB status -> next DB status (or null = no change).
function nextStatus(phase, currentStatus) {
  if (phase === 'NotFound') return currentStatus === 'terminating' ? 'terminated' : 'failed';
  if (phase === 'Running') return currentStatus === 'creating' ? 'running' : null;
  if (phase === 'Failed' || phase === 'Succeeded') return currentStatus === 'creating' ? 'failed' : null;
  return null; // Pending, Unknown -> no change, avoid flapping on transient states
}

async function reconcileRow(row) {
  if (row.status !== 'creating' && row.status !== 'terminating') return row;
  const phase = await k8sService.getPodPhase(row.pod_name);
  const next = nextStatus(phase, row.status);
  if (!next) return row;
  const terminatedAt = next === 'terminated' ? new Date() : row.terminated_at;
  const result = await pool.query(
    `UPDATE instances SET status = $1, terminated_at = $2 WHERE id = $3 RETURNING *`,
    [next, terminatedAt, row.id]
  );
  return result.rows[0];
}

async function listInstances(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM instances WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  const reconciled = await Promise.all(rows.map(reconcileRow));
  return reconciled.map(toApiShape);
}

async function getInstanceForUser(userId, instanceId) {
  const { rows } = await pool.query(
    `SELECT * FROM instances WHERE id = $1 AND user_id = $2`,
    [instanceId, userId]
  );
  if (!rows[0]) return null;
  return toApiShape(await reconcileRow(rows[0]));
}

async function createInstance(userId, distro = DEFAULT_DISTRO) {
  if (!k8sService.DISTROS.includes(distro)) {
    const err = new Error(`Invalid distro '${distro}' - must be one of: ${k8sService.DISTROS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const instances = await listInstances(userId);
  const activeCount = instances.filter((i) => ACTIVE_STATUSES.includes(i.status)).length;
  if (activeCount >= MAX_INSTANCES_PER_USER) {
    const err = new Error(`Maximum of ${MAX_INSTANCES_PER_USER} concurrent instances reached`);
    err.status = 409;
    throw err;
  }

  const instanceId = crypto.randomUUID();
  const podName = `inst-${instanceId.replace(/-/g, '')}`;
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  const { rows } = await pool.query(
    `INSERT INTO instances (id, user_id, pod_name, distro, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [instanceId, userId, podName, distro, expiresAt]
  );

  try {
    // Isolation policy first: it's a no-op if the pod doesn't exist yet, but
    // creating the pod before its policy exists would leave a real (if
    // brief) window where the new pod has no isolation from other users'.
    await k8sService.ensureUserNetworkPolicy(userId);
    await k8sService.createInstancePod({ instanceId, userId, podName, distro });
  } catch (err) {
    await pool.query(`UPDATE instances SET status = 'failed' WHERE id = $1`, [instanceId]);
    const wrapped = new Error('Failed to create instance');
    wrapped.status = 502;
    throw wrapped;
  }

  await pool.query(
    `INSERT INTO activity_logs (user_id, instance_id, action) VALUES ($1, $2, 'instance_create')`,
    [userId, instanceId]
  );
  return toApiShape(rows[0]);
}

async function terminateInstance(userId, instanceId) {
  const { rows } = await pool.query(
    `SELECT * FROM instances WHERE id = $1 AND user_id = $2`,
    [instanceId, userId]
  );
  if (!rows[0]) return null;
  const row = rows[0];

  if (row.status === 'terminated' || row.status === 'failed') {
    const err = new Error(`Instance already ${row.status}`);
    err.status = 409;
    throw err;
  }
  if (row.status === 'terminating') return toApiShape(row);

  await pool.query(`UPDATE instances SET status = 'terminating' WHERE id = $1`, [instanceId]);
  await k8sService.deletePod(row.pod_name);
  await pool.query(
    `INSERT INTO activity_logs (user_id, instance_id, action) VALUES ($1, $2, 'instance_terminate')`,
    [userId, instanceId]
  );

  const { rows: updated } = await pool.query(`SELECT * FROM instances WHERE id = $1`, [instanceId]);
  return toApiShape(updated[0]);
}

let reaping = false;
async function reapExpiredInstances() {
  if (reaping) return;
  reaping = true;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM instances WHERE status IN ('creating','running') AND expires_at < now()`
    );
    for (const row of rows) {
      try {
        await pool.query(`UPDATE instances SET status = 'terminating' WHERE id = $1`, [row.id]);
        await k8sService.deletePod(row.pod_name);
        await pool.query(
          `UPDATE instances SET status = 'terminated', terminated_at = now() WHERE id = $1`,
          [row.id]
        );
        await pool.query(
          `INSERT INTO activity_logs (user_id, instance_id, action, details) VALUES ($1, $2, 'instance_expired', $3)`,
          [row.user_id, row.id, JSON.stringify({ podName: row.pod_name })]
        );
      } catch (err) {
        console.error(`TTL reaper failed for instance ${row.id}`, err);
      }
    }
  } catch (err) {
    // A transient DB/network blip here must never take the whole process
    // down - setInterval doesn't await its callback, so an uncaught
    // rejection here becomes an unhandled rejection, which is fatal by
    // default on Node 15+. Log and retry on the next tick instead.
    console.error('TTL reaper failed to query expired instances', err);
  } finally {
    reaping = false;
  }
}

function startTtlReaper() {
  setInterval(reapExpiredInstances, 30_000);
}

module.exports = {
  MAX_INSTANCES_PER_USER,
  listInstances,
  getInstanceForUser,
  createInstance,
  terminateInstance,
  reapExpiredInstances,
  startTtlReaper,
};
