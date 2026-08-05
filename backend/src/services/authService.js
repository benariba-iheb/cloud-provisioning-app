const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;
const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30m' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// "30m" / "1h" / "600s" -> milliseconds, for the cookie's maxAge.
function expiresInToMs(str) {
  const match = /^(\d+)([smhd])$/.exec(str || '');
  if (!match) return 30 * 60 * 1000;
  return Number(match[1]) * UNIT_MS[match[2]];
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, expiresInToMs };
