import type { IO } from '../../src/cli/io.ts';

/** An in-memory IO for running commands in tests. */
export interface MemoryIO extends IO {
  out: string;
  err: string;
}

export function memoryIO(cwd: string, stdin = '', env: NodeJS.ProcessEnv = {}): MemoryIO {
  const io: MemoryIO = {
    cwd,
    env,
    out: '',
    err: '',
    isTTY: false,
    stdout(text) {
      io.out += text;
    },
    stderr(text) {
      io.err += text;
    },
    async readStdin() {
      return stdin;
    },
  };
  return io;
}
