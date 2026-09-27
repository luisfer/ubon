const express = require('express');
const jwt = require('jsonwebtoken');
const passportJwt = require('passport-jwt');

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  req.user = jwt.decode(token); // expect-block: web/jwt-unverified
  next();
}

function readRefreshToken(refreshToken) {
  return jwt.verify(refreshToken, process.env.JWT_SECRET, { ignoreExpiration: true }); // expect-block: web/jwt-unverified
}

function readAccessToken(token) {
  return jwt.verify(token, process.env.JWT_PUBLIC_KEY, { algorithms: ['RS256', 'none'] }); // expect-block: web/jwt-unverified
}

function issueGuestToken() {
  return jwt.sign({ role: 'guest' }, '', { algorithm: 'none' }); // expect-block: web/jwt-unverified
}

const strategy = new passportJwt.Strategy(
  { secretOrKey: process.env.JWT_SECRET, algorithms: ['HS256'], ignoreExpiration: false }, // ok: fixed algorithm and expiry enforced
  (payload, done) => done(null, payload),
);

const app = express();
app.get('/me', requireAuth, (req, res) => res.json(req.user));
module.exports = { app, strategy, readRefreshToken, readAccessToken, issueGuestToken };
