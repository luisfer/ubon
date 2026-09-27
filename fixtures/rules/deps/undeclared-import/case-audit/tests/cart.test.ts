import { describe, expect, it } from 'vitest'; // ok: declared dev dependency
import { setupServer } from 'msw/node'; // expect-warn: deps/undeclared-import

describe('cart', () => {
  it('adds items', () => {
    expect(setupServer).toBeDefined();
  });
});
