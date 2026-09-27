const express = require('express');
const path = require('node:path');

const router = express.Router();
const UPLOADS = path.join(__dirname, '..', '..', 'uploads');

router.get('/download', (req, res) => {
  const file = req.query.name;
  res.sendFile(path.join(UPLOADS, file));
});

module.exports = router;
