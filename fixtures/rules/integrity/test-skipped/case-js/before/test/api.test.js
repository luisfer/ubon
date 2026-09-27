const assert = require('node:assert');
const { test } = require('node:test');

test('parses json', () => {
  assert.deepEqual(JSON.parse('{}'), {});
});

test('reads settings', () => {
  assert.equal(typeof process.env, 'object');
});
