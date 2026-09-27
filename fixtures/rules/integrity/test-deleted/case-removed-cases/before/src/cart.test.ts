import { describe, expect, it } from 'vitest';
import { applyDiscount, total } from './cart';

describe('cart', () => {
  it('sums items', () => {
    expect(total([1, 2])).toBe(3);
  });

  it('applies a discount', () => {
    expect(applyDiscount(100, 10)).toBe(90);
  });

  it('handles empty carts', () => {
    expect(total([])).toBe(0);
  });

  it('works for one item', () => {
    const items = [5];
    expect(total(items)).toBe(5);
    expect(items).toHaveLength(1);
  });

  it.skip('supports currencies', () => {
    expect(total([1])).toBe(1);
  });

  it('handles negative prices', () => {
    expect(total([5, -2])).toBe(3);
  });
});
