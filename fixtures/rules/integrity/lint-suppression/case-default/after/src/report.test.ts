/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest';
import { report } from './report';

it('reports totals', () => {
  // ok: line-level and rule-scoped disables in tests are not reported
  // eslint-disable-next-line no-console
  console.log(report([1] as any));
  expect(report([1, 2])).toContain('3');
});
