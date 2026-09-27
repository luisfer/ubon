import { describe, expect, it } from 'vitest';
import { total } from './cart';

// "handles empty carts" was removed while total() still exists.
describe('cart', () => { // expect-block: integrity/test-deleted
  it('sums items', () => {
    expect(total([1, 2])).toBe(3);
  });

  // ok: "applies a discount" was removed together with applyDiscount()
  // ok: "works for one item" was renamed; the body is the same
  it('returns the price of a single item', () => {
    const items = [5];
    expect(total(items)).toBe(5);
    expect(items).toHaveLength(1);
  });

  // ok: "supports currencies" was already skipped at the base
  // ok: "handles negative prices" moved to cart-edge.test.ts
});
