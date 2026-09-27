const express = require('express');
const vm = require('node:vm');

const app = express();

app.post('/calc', (req, res) => {
  const result = eval(req.body.expression); // expect: web/code-eval
  res.json({ result });
});

app.post('/fn', (req, res) => {
  const fn = new Function('x', req.body.body); // expect: web/code-eval
  res.json({ value: fn(1) });
});

app.get('/plugin', async (req, res) => {
  const mod = await import(`./plugins/${req.query.name}.js`); // expect: web/code-eval
  res.json(mod.info);
});

app.post('/tick', (req, res) => {
  setTimeout(req.body.code, 100); // expect: web/code-eval
  setTimeout(() => res.end(), 100); // ok: a function, not a string
});

app.post('/sandbox', (req, res) => {
  res.json(vm.runInNewContext(req.body.script, {})); // expect: web/code-eval
});

app.post('/data', (req, res) => {
  const data = JSON.parse(req.body.payload); // ok: parsing data does not run it
  const globalObject = new Function('return this')(); // ok: constant code
  res.json({ data, hasGlobal: Boolean(globalObject) });
});

const PLUGINS = { csv: () => import('./plugins/csv.js'), pdf: () => import('./plugins/pdf.js') };

app.get('/export', async (req, res) => {
  const load = PLUGINS[req.query.format];
  if (!load) return res.status(400).end();
  const plugin = await load(); // ok: module chosen from a fixed map in code
  res.send(plugin.run());
});
