import { Sandbox } from '@e2b/code-interpreter';
import { tool } from 'ai';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';

const run = promisify(exec);
const ALLOWED = ['ls', 'pwd', 'git status'];

export const runCommand = tool({
  description: 'Run a shell command in the workspace',
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ command }) => {
    const { stdout } = await run(command); // expect: llm/tool-dangerous-capability
    return stdout;
  },
});

export const gitLog = tool({
  description: 'Show the git log of a branch',
  inputSchema: z.object({ branch: z.enum(['main', 'develop']) }),
  execute: async ({ branch }) => (await run(`git log ${branch} --oneline`)).stdout, // ok: branch is an enum
});

export const safeShell = tool({
  description: 'Run one of the allowed commands',
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ command }) => {
    if (!ALLOWED.includes(command)) throw new Error('Command not allowed');
    return (await run(command)).stdout; // ok: checked against an allowlist
  },
});

export const writeNote = tool({
  description: 'Write a file',
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path, content }) => fs.writeFile(path, content), // expect: llm/tool-dangerous-capability
});

export const saveNote = tool({
  description: 'Save a note',
  inputSchema: z.object({ title: z.string(), content: z.string() }),
  execute: async ({ title, content }) => fs.writeFile(`notes/${randomUUID()}.md`, `# ${title}\n\n${content}`), // ok: the path is generated in code; the model only writes the content
});

export const readFile = tool({
  description: 'Read a file from the project',
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path }) => fs.readFile(path, 'utf8'), // expect-warn: llm/tool-dangerous-capability
});

export const deleteFile = tool({
  description: 'Delete a file',
  inputSchema: z.object({ path: z.string() }),
  needsApproval: true,
  execute: async ({ path }) => fs.rm(path), // expect-warn: llm/tool-dangerous-capability
});

export const runPython = tool({
  description: 'Run Python code in a sandbox',
  inputSchema: z.object({ code: z.string() }),
  execute: async ({ code }) => {
    const sandbox = await Sandbox.create();
    return sandbox.runCode(code); // ok: the code runs in a remote sandbox, not on this server
  },
});

export const calculate = tool({
  description: 'Evaluate a math expression',
  inputSchema: z.object({ expression: z.string() }),
  execute: async ({ expression }) => String(eval(expression)), // expect: llm/tool-dangerous-capability
});
