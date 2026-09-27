import { describe, expect, it, test } from 'vitest';
import { discount, total } from './cart';

describe('total', () => {
  it.skip('adds prices', () => { // expect-block: integrity/test-skipped
    expect(total([1, 2])).toBe(3);
  });

  it.only('handles an empty cart', () => { // expect-block: integrity/test-skipped
    expect(total([])).toBe(0);
  });

  // ok: this skip existed at the base; only the assertion below it changed
  it.skip('rounds to cents', () => {
    expect(total([0.1, 0.2])).toBeCloseTo(0.3);
  });

  // "supports currencies" was un-skipped while "adds prices" was skipped: the new skip is still reported
  it('supports currencies', () => {
    expect(total([1])).toBe(1);
  });

  test.skipIf(true)('applies a coupon', () => { // expect-block: integrity/test-skipped
    expect(total([5])).toBe(5);
  });

  // ok: skipIf with a real condition is a deliberate platform check
  test.skipIf(process.platform === 'win32')('uses POSIX paths', () => {
    expect('/').toBe('/');
  });

  // ok: runIf with a condition that can be true
  test.runIf(process.env.INTEGRATION === '1')('talks to the database', () => {
    expect(true).toBe(true);
  });
});

describe('discount', () => {
  it('applies a percentage', () => {
    expect(discount(100, 10)).toBe(90);
  });

  it.todo('caps discounts at 100 percent'); // expect-block: integrity/test-skipped
});

// ok: a helper named skip is not a test modifier
const skip = (n: number) => n + 1;
it('uses a helper named skip', () => {
  expect(skip(1)).toBe(2);
});
