import type { IO } from '../cli/io.ts';
import { EXIT } from '../cli/main.ts';

export async function runHook(_argv: string[], io: IO): Promise<number> {
  io.stderr('ubon: this command is not available yet.\n');
  return EXIT.usage;
}
