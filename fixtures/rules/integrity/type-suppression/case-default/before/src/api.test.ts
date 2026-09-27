import { expect, it } from 'vitest';
import { parseUser } from './user';

it('parses a user', () => {
  expect(parseUser({ id: 1, name: 'Ada' }).name).toBe('Ada');
});
