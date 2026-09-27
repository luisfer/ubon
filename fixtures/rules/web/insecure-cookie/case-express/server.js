const express = require('express');
const { sign } = require('./auth');
const { SESSION_COOKIE_NAME, THEME_COOKIE_NAME } = require('./config');

const app = express();

app.post('/login', (req, res) => {
  const token = sign(req.body);
  res.cookie('token', token); // expect: web/insecure-cookie
  res.cookie('connect.sid', token, { httpOnly: true, secure: true }); // ok: both flags
  res.cookie('remember_me', '1', { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true }); // expect: web/insecure-cookie
  res.cookie('XSRF-TOKEN', req.csrfToken()); // ok: CSRF cookies must be readable by scripts
  res.cookie('locale', 'en'); // ok: not an auth cookie
  res.setHeader('Set-Cookie', `session=${token}; Path=/; SameSite=Lax`); // expect: web/insecure-cookie
  res.setHeader('Set-Cookie', [`session=${token}; Path=/; HttpOnly; Secure`]); // ok: both flags in the string
  res.setHeader('Set-Cookie', `jwt=${token}; Path=/; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); // ok: Secure is added in production
  res.json({ ok: true });
});

app.post('/refresh', (req, res) => {
  res.cookie(SESSION_COOKIE_NAME, sign(req.body), { httpOnly: true }); // expect: web/insecure-cookie
  res.cookie(THEME_COOKIE_NAME, 'dark'); // ok: a constant named after a non-auth cookie
  res.sendStatus(204);
});

app.listen(3000);
