const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');

const router = express.Router();

function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex');
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  await db.query('insert into users (email, password_hash) values ($1, $2)', [email, hashPassword(password)]);
  res.status(201).json({ ok: true });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query('select id, password_hash from users where email = $1', [email]);
  const user = rows[0];
  if (!user || user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'invalid login' });
  const sessionId = crypto.randomBytes(32).toString('hex');
  await db.query('insert into sessions (id, user_id) values ($1, $2)', [sessionId, user.id]);
  res.cookie('sid', sessionId, { maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true });
});

module.exports = router;
