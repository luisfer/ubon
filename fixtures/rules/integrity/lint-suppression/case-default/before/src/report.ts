export function report(values: number[]): string {
  const total = values.reduce((a, b) => a + b, 0);
  return `total: ${total}`;
}
