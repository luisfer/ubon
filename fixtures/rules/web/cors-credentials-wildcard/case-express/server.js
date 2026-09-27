const express = require('express');
const cors = require('cors');

const ALLOWED_ORIGINS = ['https://app.example.com', 'https://admin.example.com'];
const app = express();

app.use('/v1', cors({ origin: true, credentials: true })); // expect-block: web/cors-credentials-wildcard
app.use('/v2', cors({ origin: '*', credentials: true })); // expect-block: web/cors-credentials-wildcard
app.use('/v3', cors({ credentials: true })); // expect-block: web/cors-credentials-wildcard
app.use('/v4', cors({ origin: (origin, callback) => callback(null, true), credentials: true })); // expect-block: web/cors-credentials-wildcard
app.use('/v5', cors({ origin: ALLOWED_ORIGINS, credentials: true })); // ok: fixed list of origins
app.use('/v6', cors({ origin: (origin, cb) => cb(null, ALLOWED_ORIGINS.includes(origin)), credentials: true })); // ok: the callback checks a list
app.use('/public', cors()); // ok: public API without credentials
app.use('/assets', cors({ origin: '*' })); // ok: wildcard without credentials
app.use('/config', cors({ origin: process.env.CORS_ORIGIN, credentials: true })); // ok: origin from configuration

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin); // expect-block: web/cors-credentials-wildcard
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); // ok: checked against a list before echoing
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // ok: no credentials header
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.listen(3000);
