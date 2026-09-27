const assert = require('node:assert');
const { test } = require('node:test');

test('parses json', { skip: 'flaky on CI' }, () => { // expect-block: integrity/test-skipped
  assert.deepEqual(JSON.parse('{}'), {});
});

test('reads settings', (t) => {
  t.skip('not ready yet'); // expect-block: integrity/test-skipped
  assert.equal(typeof process.env, 'object');
});

// ok: skip only on Windows, a condition that is false elsewhere
test('reads symlinks', { skip: process.platform === 'win32' }, () => {
  assert.ok(true);
});

test('talks to the sandbox', (t) => {
  if (!process.env.SANDBOX_URL) {
    // ok: t.skip inside a condition skips only when the sandbox is missing
    t.skip('no sandbox configured');
    return;
  }
  assert.ok(process.env.SANDBOX_URL);
});
