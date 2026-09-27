const express = require('express');
const path = require('node:path');

const router = express.Router();
const UPLOADS = path.join(__dirname, '..', '..', 'uploads');

router.get('/download', (req, res) => {
  const target = path.resolve(UPLOADS, String(req.query.name));
  if (!target.startsWith(UPLOADS + path.sep)) return res.status(400).send('invalid name');
  res.sendFile(target);
});

module.exports = router;
