import { main } from './main.ts';

/** Entry used by dist/cli.mjs. */
export async function run(): Promise<void> {
  process.exitCode = await main(process.argv.slice(2));
}
