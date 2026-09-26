/** Process I/O behind an interface, so commands can run in tests without spawning a process. */

export interface IO {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout(text: string): void;
  stderr(text: string): void;
  readStdin(maxBytes: number): Promise<string>;
  isTTY: boolean;
}

export function processIO(): IO {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    readStdin: (maxBytes) => readStream(process.stdin, maxBytes),
    isTTY: Boolean(process.stdout.isTTY),
  };
}

export class StdinTooLarge extends Error {
  constructor() {
    super('input is larger than the limit');
    this.name = 'StdinTooLarge';
  }
}

export function readStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if ((stream as { isTTY?: boolean }).isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > maxBytes) {
        reject(new StdinTooLarge());
        (stream as { destroy?: () => void }).destroy?.();
        return;
      }
      chunks.push(buf);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/** True when Ubon runs inside a coding agent's shell tool. */
export function detectAgentShell(env: NodeJS.ProcessEnv): string | null {
  if (env.CLAUDECODE === '1') return 'claude';
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return 'codex';
  if (env.GEMINI_CLI === '1') return 'gemini';
  if (env.COPILOT_CLI === '1' || env.COPILOT_AGENT_PROMPT) return 'copilot';
  if (env.CURSOR_AGENT === '1') return 'cursor';
  return null;
}

/** Session identifier exported into the agent's shell, when the agent does that. */
export function sessionIdFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.CLAUDE_CODE_SESSION_ID || env.CODEX_THREAD_ID || env.GEMINI_SESSION_ID || null;
}
