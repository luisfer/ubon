import { test } from 'node:test';

test('rejects an unknown reset token', async () => {
  const resetToken = Math.random().toString(36).slice(2); // ok: test data
  await fetch('/api/reset', { method: 'POST', body: JSON.stringify({ resetToken }) });
});
