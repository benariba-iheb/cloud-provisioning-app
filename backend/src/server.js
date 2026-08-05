require('dotenv').config();

const http = require('http');
const { PassThrough } = require('stream');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { parse: parseCookie } = require('cookie');
const { WebSocketServer } = require('ws');

const { pool } = require('./db/pool');
const { verifyToken } = require('./services/authService');
const instanceService = require('./services/instanceService');
const k8sService = require('./services/k8sService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));

// Liveness: process is up, no external dependencies checked.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: process is up AND can reach PostgreSQL.
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not-ready', error: err.message });
  }
});

app.use('/auth', require('./routes/auth'));
app.use('/instances', require('./routes/instances'));

// Route modules mount here as later phases are implemented:
// app.use('/metrics', require('./routes/metrics'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

// Web terminal: a raw WebSocket upgrade at /instances/:id/terminal, bridged
// to a Kubernetes exec session. This lives outside Express's normal
// request/response cycle, so auth is done manually here rather than via the
// requireAuth middleware (which relies on cookie-parser having already run
// as Express middleware, which never happens for a raw 'upgrade' event).
const wss = new WebSocketServer({ noServer: true });
const TERMINAL_PATH_RE = /^\/instances\/([0-9a-fA-F-]{36})\/terminal$/;

function rejectUpgrade(socket, statusLine) {
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', async (req, socket, head) => {
  const pathname = req.url.split('?')[0];
  const match = TERMINAL_PATH_RE.exec(pathname);
  if (!match) {
    rejectUpgrade(socket, '404 Not Found');
    return;
  }
  const instanceId = match[1];

  const cookies = parseCookie(req.headers.cookie || '');
  let user;
  try {
    const payload = verifyToken(cookies.token);
    user = { id: payload.sub, email: payload.email };
  } catch {
    rejectUpgrade(socket, '401 Unauthorized');
    return;
  }

  let instance;
  try {
    instance = await instanceService.getInstanceForUser(user.id, instanceId);
  } catch (err) {
    console.error('Failed to look up instance for terminal upgrade', err);
    rejectUpgrade(socket, '500 Internal Server Error');
    return;
  }
  // Same 404 for "doesn't exist" and "not yours" - don't leak which one it is.
  if (!instance) {
    rejectUpgrade(socket, '404 Not Found');
    return;
  }
  if (instance.status !== 'running') {
    rejectUpgrade(socket, '409 Conflict');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, { instance, user });
  });
});

wss.on('connection', async (ws, { instance, user }) => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  stdout.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });
  stderr.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });
  ws.on('message', (data) => stdin.write(data));

  let execWs;
  try {
    execWs = await k8sService.execIntoPod(instance.podName, {
      stdout,
      stderr,
      stdin,
      statusCallback: () => ws.close(),
    });
  } catch (err) {
    console.error('Failed to start exec session', err);
    ws.close(1011, 'Failed to start terminal session');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO activity_logs (user_id, instance_id, action) VALUES ($1, $2, 'terminal_connect')`,
      [user.id, instance.id]
    );
  } catch (err) {
    console.error('Failed to log terminal_connect', err);
  }

  ws.on('close', () => {
    stdin.end();
    try {
      execWs.close();
    } catch {
      // already closed
    }
  });
  execWs.on('close', () => {
    try {
      ws.close();
    } catch {
      // already closed
    }
  });
});

instanceService.startTtlReaper();

server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
