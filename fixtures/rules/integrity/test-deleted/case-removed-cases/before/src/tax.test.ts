import { expect, it } from 'vitest';
import { tax } from './tax';

it('rounds tax', () => {
  expect(tax(10)).toBe(2);
});
