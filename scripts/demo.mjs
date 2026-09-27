#!/usr/bin/env node
// Replays a recorded agent session (fixtures/sessions/<agent>/<scenario>.jsonl)
// in the terminal and shows what Ubon told the agent at each step. No API key
// and no network: the agent's tool calls come from the recording, and Ubon
// runs for real on a temporary copy of the fixture app.
//
//   npm run demo                      the default scenario
//   npm run demo -- <agent>/<scenario>
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { styleText } from 'node:util';

const root = join(import.meta.dirname, '..');
const sessions = join(root, 'fixtures', 'sessions');
const wanted = process.argv[2] ?? 'claude/ssrf-then-fix';
const file = join(sessions, `${wanted}.jsonl`);
if (!existsSync(file)) {
  const all = existsSync(sessions) ? readdirSync(sessions).flatMap((a) => readdirSync(join(sessions, a)).map((f) => `${a}/${f.replace(/\.jsonl$/, '')}`)) : [];
  console.error(`No recorded session ${wanted}. Recorded sessions: ${all.join(', ') || 'none'}.`);
  process.exit(2);
}

const { runHook } = await import('../src/hook/command.ts');
const { expandFakeKeysInDir } = await import('../test/support/fake-keys.ts');
const { commitAll, initRepo } = await import('../test/support/fixtures.ts');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (format, text) => (color ? styleText(format, text) : text);
const [headerLine, ...lines] = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const header = JSON.parse(headerLine);
const dir = mkdtempSync(join(tmpdir(), 'ubon-demo-'));
const swap = (value, from, to) => JSON.parse(JSON.stringify(value).split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1)));

console.log(paint('bold', `${header.agent} ${header.agentVersion}, recorded ${header.recorded}, on fixtures/apps/${header.app}`));
console.log(`Task: ${header.note}\n`);

try {
  if (header.app) cpSync(join(root, 'fixtures', 'apps', header.app, 'app'), dir, { recursive: true });
  expandFakeKeysInDir(dir);
  initRepo(dir);
  commitAll(dir, 'start');
  for (const line of lines) {
    const step = swap(JSON.parse(line), header.cwd, dir);
    const input = step.payload.tool_input ?? {};
    const tool = step.payload.tool_name ?? '';
    const target = typeof input.file_path === 'string' ? relative(dir, isAbsolute(input.file_path) ? input.file_path : resolve(dir, input.file_path)) : typeof input.command === 'string' ? input.command : '';
    if (/^(PostToolUse|postToolUse|AfterTool)$/.test(step.event) && typeof input.file_path === 'string') applyWrite(tool, input, dir);
    let out = '';
    let err = '';
    const io = { cwd: dir, env: {}, isTTY: false, stdout: (t) => (out += t), stderr: (t) => (err += t), readStdin: async () => JSON.stringify(step.payload) };
    await runHook([step.agent, step.event], io);
    const what = [step.event, tool, target].filter(Boolean).join(' ');
    console.log(`${paint('dim', '>')} ${what}`);
    const said = explain(out);
    if (said) console.log(`  ${said.split('\n').join('\n  ')}`);
    else console.log(`  ${paint('green', 'allowed')}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function applyWrite(tool, input, cwd) {
  const path = isAbsolute(input.file_path) ? input.file_path : resolve(cwd, input.file_path);
  if (tool === 'Write') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, input.content ?? '');
    return;
  }
  if (!existsSync(path)) return;
  let text = readFileSync(path, 'utf8');
  for (const e of tool === 'MultiEdit' ? (input.edits ?? []) : [input]) {
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  }
  writeFileSync(path, text);
}

/** What the agent was told, from Claude Code's hook output format. */
function explain(stdout) {
  if (!stdout.trim()) return '';
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return stdout.trim();
  }
  const specific = data.hookSpecificOutput ?? {};
  if (specific.permissionDecision === 'deny') return `${paint('red', 'denied')}: ${specific.permissionDecisionReason}`;
  if (specific.permissionDecision === 'ask') return `${paint('yellow', 'asks you')}: ${specific.permissionDecisionReason}`;
  if (data.decision === 'block') return `${paint('red', 'sent back to the agent')}: ${data.reason}`;
  if (specific.additionalContext) return `${paint('yellow', 'told the agent')}: ${specific.additionalContext}`;
  if (data.systemMessage) return data.systemMessage;
  return '';
}
