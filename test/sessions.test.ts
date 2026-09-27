import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { runHook } from '../src/hook/command.ts';
import { expandFakeKeysInDir } from './support/fake-keys.ts';
import { commitAll, FIXTURES, initRepo, tempDir } from './support/fixtures.ts';
import { memoryIO } from './support/io.ts';

/**
 * Recorded sessions (fixtures/sessions/<agent>/<scenario>.jsonl) replay real
 * hook payloads through `ubon hook` and compare Ubon's answers with the ones
 * it gave when the session was recorded.
 *
 * The first line describes the recording: the agent and its version, the
 * fixture app the session started from, and the working directory at the
 * time (replaced by a temporary copy of the app). Each other line is what
 * `ubon hook <agent> <event> --record <file>` wrote: the payload and Ubon's
 * output, both masked. Before a post-tool event for a file write, the replay
 * applies the write from the payload, as the real tool did.
 */

interface Header {
  scenario: string;
  agent: string;
  agentVersion: string;
  app: string | null;
  cwd: string;
  recorded: string;
  note?: string;
}

interface Step {
  agent: string;
  event: string;
  payload: Record<string, unknown>;
  output: { stdout?: string; stderr?: string; exitCode: number };
}

const SESSIONS = join(FIXTURES, 'sessions');
const files = existsSync(SESSIONS)
  ? readdirSync(SESSIONS).flatMap((agent) => readdirSync(join(SESSIONS, agent)).filter((f) => f.endsWith('.jsonl')).map((f) => join(agent, f)))
  : [];

function replacePaths(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((v) => replacePaths(v, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replacePaths(v, from, to)]));
  return value;
}

/** The file changes a tool made before its post-tool hook ran. */
function applyWrite(step: Step, dir: string): void {
  const input = (step.payload.tool_input ?? {}) as Record<string, unknown>;
  const tool = String(step.payload.tool_name ?? '');
  const path = typeof input.file_path === 'string' ? (isAbsolute(input.file_path) ? input.file_path : resolve(dir, input.file_path)) : null;
  if (!path) return;
  if (tool === 'Write' && typeof input.content === 'string') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, input.content);
    return;
  }
  const edits = tool === 'Edit' ? [input] : tool === 'MultiEdit' && Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
  if (edits.length === 0 || !existsSync(path)) return;
  let text = readFileSync(path, 'utf8');
  for (const e of edits) {
    const oldString = String(e.old_string ?? '');
    const newString = String(e.new_string ?? '');
    text = e.replace_all === true ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
  }
  writeFileSync(path, text);
}

function normalized(stdout: string | undefined): unknown {
  const text = (stdout ?? '').trim();
  if (text === '') return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe('recorded sessions', () => {
  for (const file of files) {
    test(file, async () => {
      const [headerLine, ...lines] = readFileSync(join(SESSIONS, file), 'utf8').split('\n').filter((l) => l.trim());
      const header = JSON.parse(headerLine as string) as Header;
      const steps = lines.map((l) => JSON.parse(l) as Step);
      const dir = tempDir(`ubon-session-${header.agent}-`);
      try {
        if (header.app) cpSync(join(FIXTURES, 'apps', header.app, 'app'), dir, { recursive: true });
        expandFakeKeysInDir(dir);
        initRepo(dir);
        commitAll(dir, 'start');
        for (const [i, recorded] of steps.entries()) {
          const step = replacePaths(recorded, header.cwd, dir) as Step;
          if (/^(PostToolUse|postToolUse|AfterTool|afterFileEdit)$/.test(step.event)) applyWrite(step, dir);
          const io = memoryIO(dir, JSON.stringify(step.payload));
          const code = await runHook([step.agent, step.event], io);
          const where = `${file} step ${i + 1} (${step.event}${step.payload.tool_name ? ` ${String(step.payload.tool_name)}` : ''})`;
          assert.equal(code, recorded.output.exitCode, `${where}: exit code`);
          assert.deepEqual(normalized(replacePaths(io.out, dir, header.cwd) as string), normalized(recorded.output.stdout), `${where}: output differs from the recording`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
