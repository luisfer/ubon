const express = require('express');

const app = express();
const ALLOWED_RETURNS = ['/dashboard', '/settings'];

app.get('/sso/done', (req, res) => {
  res.redirect(req.query.returnTo); // expect: web/open-redirect
});

app.get('/profile/:id', (req, res) => {
  res.redirect(302, `/users/${req.params.id}`); // ok: fixed first path segment
});

app.get('/continue', (req, res) => {
  const next = req.query.next;
  if (!ALLOWED_RETURNS.includes(next)) return res.redirect('/');
  res.redirect(next); // ok: checked against an allowlist
});
