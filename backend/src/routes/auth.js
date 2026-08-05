const express = require('express');
const rateLimit = require('express-rate-limit');

const { pool } = require('../db/pool');
const {
  hashPassword,
  verifyPassword,
  signToken,
  expiresInToMs,
} = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const COOKIE_NAME = 'token';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: expiresInToMs(process.env.JWT_EXPIRES_IN || '30m'),
  });
}

function validateCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return 'A valid email address is required';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (password.length > 72) {
    // bcrypt silently ignores bytes past 72 - reject instead of truncating quietly.
    return 'Password must be at most 72 characters';
  }
  return null;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const validationError = validateCredentials(email, password);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    let user;
    try {
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, last_seen_at)
         VALUES ($1, $2, now())
         RETURNING id, email`,
        [normalizedEmail, passwordHash]
      );
      user = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw err;
    }

    await pool.query(
      `INSERT INTO activity_logs (user_id, action) VALUES ($1, 'register')`,
      [user.id]
    );

    setAuthCookie(res, signToken(user));
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await pool.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);
    await pool.query(
      `INSERT INTO activity_logs (user_id, action) VALUES ($1, 'login')`,
      [user.id]
    );

    setAuthCookie(res, signToken(user));
    res.status(200).json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(200).json({ message: 'Logged out' });
});

router.get('/me', requireAuth, (req, res) => {
  res.status(200).json({ user: req.user });
});

module.exports = router;
