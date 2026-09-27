import { expect, it } from 'vitest';
import { total } from './cart';

it('handles large carts', () => {
  expect(total(new Array(1000).fill(1))).toBe(1000);
});

it('handles negative prices', () => {
  expect(total([5, -2])).toBe(3);
});
