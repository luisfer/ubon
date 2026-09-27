const express = require('express');
const { exec } = require('node:child_process');

const router = express.Router();

// Lets the admin page check whether a host is reachable.
router.get('/ping', (req, res) => {
  exec(`ping -c 1 ${req.query.host}`, (error, stdout) => {
    res.type('text/plain').send(error ? 'unreachable' : stdout);
  });
});

module.exports = router;
