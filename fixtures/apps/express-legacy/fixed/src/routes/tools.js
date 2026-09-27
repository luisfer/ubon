const express = require('express');
const { execFile } = require('node:child_process');

const router = express.Router();
const HOSTNAME = /^[a-z0-9.-]{1,253}$/i;

// Lets the admin page check whether a host is reachable.
router.get('/ping', (req, res) => {
  const host = String(req.query.host);
  if (!HOSTNAME.test(host)) return res.status(400).send('invalid host');
  execFile('ping', ['-c', '1', '--', host], (error, stdout) => {
    res.type('text/plain').send(error ? 'unreachable' : stdout);
  });
});

module.exports = router;
