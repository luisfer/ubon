const express = require('express');
const { execSync, spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const app = express();
const db = new Database('jobs.db');

app.post('/ping', (req, res) => {
  const out = execSync('ping -c 1 ' + req.body.host); // expect: web/command-injection
  spawnSync('sh', ['-c', `git log ${req.body.ref}`]); // expect: web/command-injection
  res.send(out);
});

app.post('/git', (req, res) => {
  const ref = req.body.ref;
  if (!/^[a-zA-Z0-9._-]+$/.test(ref)) return res.status(400).end();
  res.send(execSync(`git show ${ref}`)); // ok: ref must match an anchored character allowlist
});

app.post('/run', (req, res) => {
  const child = spawn(req.body.tool, ['--version']); // expect: web/command-injection
  child.stdout.pipe(res);
});

app.post('/jobs', (req, res) => {
  db.exec(`INSERT INTO jobs (name) VALUES ('${req.body.name}')`); // ok: a database client's exec, not a shell (see web/sql-injection)
  res.status(201).end();
});

app.post('/formats', (req, res) => {
  const ALLOWED = ['png', 'jpg', 'webp'];
  const format = req.body.format;
  if (!ALLOWED.includes(format)) return res.status(400).end();
  res.send(execSync(`convert in.bmp out.${format}`)); // ok: format checked against an allowlist
});
