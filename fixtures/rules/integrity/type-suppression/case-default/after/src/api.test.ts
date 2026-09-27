// @ts-nocheck // expect-block: integrity/type-suppression
import { expect, it } from 'vitest';
import { parseUser } from './user';

it('parses a user', () => {
  // ok: tests cast mocks with `as any`
  const input = { id: 1, name: 'Ada' } as any;
  expect(parseUser(input).name).toBe('Ada');
});

it('rejects bad input', () => {
  // ok: tests pass invalid arguments on purpose
  // @ts-expect-error
  expect(() => parseUser()).toThrow();
});
