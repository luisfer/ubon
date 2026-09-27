const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const UPLOADS = path.join(__dirname, 'uploads');

app.get('/files/:name', (req, res) => {
  res.sendFile(path.join(UPLOADS, req.params.name)); // expect: web/path-traversal
});

app.get('/raw/:name', (req, res) => {
  fs.readFile(`./uploads/${req.params.name}`, (err, data) => res.send(data)); // expect: web/path-traversal
});

app.get('/safe/:name', (req, res) => {
  res.sendFile(path.join(UPLOADS, path.basename(req.params.name))); // ok: basename keeps only the file name
});

app.get('/static/:name', (req, res) => {
  res.sendFile(req.params.name, { root: UPLOADS }); // ok: sendFile with a root rejects paths that leave it
});

app.get('/checked', (req, res) => {
  const full = path.resolve(UPLOADS, String(req.query.file));
  if (!full.startsWith(UPLOADS + path.sep)) return res.status(403).end();
  fs.createReadStream(full).pipe(res); // ok: resolved path checked against the upload root
});

app.get('/relative', (req, res) => {
  const target = path.join(UPLOADS, String(req.query.file));
  const rel = path.relative(UPLOADS, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(403).end();
  fs.createReadStream(target).pipe(res); // ok: path.relative check keeps the file inside the root
});

app.delete('/files/:name', async (req, res) => {
  await fs.promises.unlink(path.join(UPLOADS, req.params.name)); // expect: web/path-traversal
  res.status(204).end();
});

app.get('/report', (req, res) => {
  fs.readFile(path.join(__dirname, 'reports', 'summary.pdf'), (err, data) => res.send(data)); // ok: constant path
});
