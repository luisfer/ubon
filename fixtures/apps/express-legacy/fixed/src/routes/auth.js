const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const db = require('../db');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'hex'));
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  await db.query('insert into users (email, password_hash) values ($1, $2)', [email, await hashPassword(password)]);
  res.status(201).json({ ok: true });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query('select id, password_hash from users where email = $1', [email]);
  const user = rows[0];
  if (!user || !(await checkPassword(password, user.password_hash))) return res.status(401).json({ error: 'invalid login' });
  const sessionId = crypto.randomBytes(32).toString('hex');
  await db.query('insert into sessions (id, user_id) values ($1, $2)', [sessionId, user.id]);
  res.cookie('sid', sessionId, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

module.exports = router;
