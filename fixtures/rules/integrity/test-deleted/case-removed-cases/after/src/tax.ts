// ubon-ignore integrity/test-deleted: luisfer: tax rules are covered by e2e/tax.spec.ts since the rewrite
export function tax(amount: number): number {
  return Math.round(amount * 0.2);
}
