import { expect, it } from 'vitest';
import { square } from './math';

it('squares numbers', () => {
  expect(square(3)).toBe(9);
});
