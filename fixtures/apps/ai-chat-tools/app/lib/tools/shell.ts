import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from 'ai';
import { z } from 'zod';

const run = promisify(exec);

// Lets the assistant check the status of the deployment server.
export const shell = tool({
  description: 'Run a shell command on the server and return its output',
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ command }) => {
    const { stdout, stderr } = await run(command, { timeout: 10_000 });
    return stdout || stderr;
  },
});
