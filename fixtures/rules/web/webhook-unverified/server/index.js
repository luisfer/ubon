const express = require('express');
const { db } = require('./db');

const app = express();

app.post('/api/github/webhook', express.json(), async (req, res) => {
  const { repository } = req.body; // expect-block: web/webhook-unverified
  if (req.headers['x-github-event'] === 'push') {
    await db.query('UPDATE repos SET synced_at = now() WHERE full_name = $1', [repository.full_name]);
  }
  res.sendStatus(204);
});

app.post('/api/contact', express.json(), async (req, res) => {
  await db.query('INSERT INTO messages (body) VALUES ($1)', [req.body.message]); // ok: not a webhook route
  res.sendStatus(204);
});

app.listen(3000);
