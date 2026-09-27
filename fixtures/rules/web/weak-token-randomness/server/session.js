const express = require('express');
const expressJwt = require('express-jwt');

const router = express.Router();

router.post('/login', async (req, res) => {
  const user = await findUser(req.body.email, req.body.password);
  const session = { sessionId: Math.random().toString(36).slice(2), userId: user.id }; // expect: web/weak-token-randomness
  res.cookie('session_id', Math.random().toString(36).slice(2), { httpOnly: true }); // expect: web/weak-token-randomness
  res.json(session);
});

// A JWT secret nobody should know, generated with Math.random().
const denyAll = () => expressJwt({ secret: '' + Math.random() }); // expect: web/weak-token-randomness

module.exports = { router, denyAll };
