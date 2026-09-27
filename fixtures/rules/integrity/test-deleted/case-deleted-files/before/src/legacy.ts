export function legacyTotal(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
}
