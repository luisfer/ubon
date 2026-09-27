import jwt from 'jsonwebtoken';
import { expect, test } from 'vitest';

test('issues a token for the user', () => {
  const token = jwt.sign({ sub: 'u1' }, 'secret');
  const decoded = jwt.decode(token) as { sub: string }; // ok: tests inspect tokens directly
  expect(decoded.sub).toBe('u1');
});
