import { expect, it } from 'vitest';
import { price } from './price';

it('formats cents as dollars', () => {
  expect(price(1999)).toBe('$19.99');
});

it('formats zero', () => {
  expect(price(0)).toBe('$0.00');
});
