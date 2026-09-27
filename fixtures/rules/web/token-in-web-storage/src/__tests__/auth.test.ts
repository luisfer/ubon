import { expect, test } from 'vitest';

test('reads the stored token', () => {
  localStorage.setItem('token', 'test-token'); // ok: tests set up storage directly
  expect(localStorage.getItem('token')).toBe('test-token');
});
