require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { pool } = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
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

// Route modules mount here as phases are implemented:
// app.use('/auth', require('./routes/auth'));
// app.use('/instances', require('./routes/instances'));
// app.use('/metrics', require('./routes/metrics'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
