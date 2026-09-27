export function log(message: string): void {
  write(message);
}

// ok: this disable existed at the base; it only moved below the function
// eslint-disable-next-line no-console
const write = console.log;
