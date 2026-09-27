/* eslint-disable */ // expect-block: integrity/lint-suppression
export function report(values: any[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy payload // expect-warn: integrity/lint-suppression
  const total = values.reduce((a: any, b: any) => a + b, 0);
  /* eslint-disable no-console */ // expect-warn: integrity/lint-suppression
  console.log(total);
  /* eslint-enable no-console */
  // ok: the directive inside a string is not a comment
  const hint = 'add /* eslint-disable */ at the top to silence everything';
  // ok: biome-ignore for formatting does not turn off a check
  // biome-ignore format: aligned table
  const table = [1,   2,   3];
  return `total: ${total} ${hint} ${table.length}`;
}
