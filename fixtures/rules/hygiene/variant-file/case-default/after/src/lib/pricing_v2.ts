export function price(n: number): number { // expect-warn: hygiene/variant-file
  return Math.round(n * 121) / 100;
}
