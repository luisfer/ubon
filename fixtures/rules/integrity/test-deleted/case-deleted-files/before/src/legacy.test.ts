import { expect, it } from 'vitest';
import { legacyTotal } from './legacy';

it('adds values', () => {
  expect(legacyTotal([1, 2, 3])).toBe(6);
});
