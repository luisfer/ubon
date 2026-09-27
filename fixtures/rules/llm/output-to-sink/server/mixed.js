const express = require('express');
const { generateText } = require('ai');
const { pool } = require('./db');

const app = express();

app.post('/ask', async (req, res) => {
  const { text } = await generateText({ model: req.app.locals.model, prompt: req.body.question });
  const rows = await pool.query(`SELECT * FROM faq WHERE topic = '${req.body.topic}' AND answer = '${text}'`); // ok: request data at the same sink is reported by web/sql-injection
  res.json(rows);
});
