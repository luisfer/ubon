const axios = require('axios');
const express = require('express');
const http = require('http');

const app = express();
const API_BASE = process.env.API_BASE;

app.get('/proxy', async (req, res) => {
  const { data } = await axios.get(req.query.url); // expect: web/ssrf
  res.send(data);
});

app.get('/users/:id', async (req, res) => {
  const { data } = await axios.get(`${API_BASE}/users/${req.params.id}`); // ok: base URL from config; request data only in the path
  res.json(data);
});

app.get('/feed', (req, res) => {
  http.get(req.query.feed, (upstream) => upstream.pipe(res)); // expect: web/ssrf
});

app.get('/status', async (req, res) => {
  const host = req.get('host');
  const { data } = await axios.get(`http://${host}/internal/status`); // ok: the Host header names this server
  res.json(data);
});
