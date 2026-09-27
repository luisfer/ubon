import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from 'ai';
import { z } from 'zod';

const run = promisify(execFile);

// Only fixed, read-only status commands; the model picks one by name.
const COMMANDS = {
  uptime: ['uptime', []],
  disk: ['df', ['-h', '/']],
} as const;

export const shell = tool({
  description: 'Check the status of the deployment server',
  inputSchema: z.object({ check: z.enum(['uptime', 'disk']) }),
  execute: async ({ check }) => {
    const [file, args] = COMMANDS[check];
    const { stdout } = await run(file, [...args], { timeout: 10_000 });
    return stdout;
  },
});
