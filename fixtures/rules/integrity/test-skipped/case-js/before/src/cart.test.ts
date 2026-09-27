import { describe, expect, it } from 'vitest';
import { discount, total } from './cart';

describe('total', () => {
  it('adds prices', () => {
    expect(total([1, 2])).toBe(3);
  });

  it('handles an empty cart', () => {
    expect(total([])).toBe(0);
  });

  it.skip('rounds to cents', () => {
    expect(total([0.1, 0.2])).toBe(0.3);
  });

  it.skip('supports currencies', () => {
    expect(total([1])).toBe(1);
  });
});

describe('discount', () => {
  it('applies a percentage', () => {
    expect(discount(100, 10)).toBe(90);
  });
});
