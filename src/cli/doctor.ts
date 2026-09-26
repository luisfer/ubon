import type { IO } from './io.ts';
import { EXIT } from './main.ts';

export async function runDoctor(_argv: string[], io: IO): Promise<number> {
  io.stderr('ubon: this command is not available yet.\n');
  return EXIT.usage;
}
