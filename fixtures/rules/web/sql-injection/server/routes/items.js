const express = require('express');
const { Pool } = require('pg');

const pool = new Pool();
const router = express.Router();
const STATUS = 'active';

router.get('/items', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM items WHERE owner = $1', [req.query.owner]); // ok: placeholder with a values array
  const page = parseInt(req.query.page, 10) || 1;
  const paged = await pool.query(`SELECT * FROM items LIMIT 20 OFFSET ${(page - 1) * 20}`); // ok: numeric cast
  const active = await pool.query(`SELECT * FROM items WHERE status = '${STATUS}'`); // ok: module constant, not request data
  const sorted = await pool.query('SELECT * FROM items ORDER BY ' + req.query.sort); // expect: web/sql-injection
  res.json({ rows, paged, active, sorted });
});

router.get('/sorted', async (req, res) => {
  const column = req.query.column;
  if (!['name', 'created_at'].includes(column)) return res.status(400).end();
  const { rows } = await pool.query(`SELECT * FROM items ORDER BY ${column}`); // ok: column checked against an allowlist first
  res.json(rows);
});

router.get('/by-ids', async (req, res) => {
  const ids = String(req.query.ids).split(',');
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(`SELECT * FROM items WHERE id IN (${placeholders})`, ids); // ok: placeholders only use the index
  res.json(rows);
});

router.get('/cached/:id', async (req, res) => {
  const hit = await cache.get(`item:${req.params.id}`); // ok: a cache key, not SQL
  const gql = await client.query({ query: ITEM_QUERY, variables: { id: req.params.id } }); // ok: GraphQL variables, not SQL text
  res.json({ hit, gql });
});

router.post('/notes', async (req, res) => {
  const { title } = req.body;
  await pool.query(`INSERT INTO notes (title) VALUES ('${title}')`); // expect: web/sql-injection
  res.status(201).end();
});

module.exports = router;
