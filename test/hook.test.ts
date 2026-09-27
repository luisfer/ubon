import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { RULE_IDS } from '../src/data/rule-ids.ts';
import { RULES } from '../src/rules/index.ts';
import { readEvents } from '../src/core/session.ts';
import { runHook } from '../src/hook/command.ts';
import { expandFakeKeys } from './support/fake-keys.ts';
import { commitAll, initRepo, tempDir, writeFiles } from './support/fixtures.ts';
import { memoryIO } from './support/io.ts';

/**
 * Hook behavior, event by event, through the same entry point the agents call
 * (`ubon hook <agent> <event>` with the payload on stdin).
 */

async function hook(dir: string, agent: string, event: string, payload: Record<string, unknown>) {
  const io = memoryIO(dir, JSON.stringify(payload));
  const code = await runHook([agent, event], io);
  return { code, out: io.out, err: io.err, json: io.out.trim() ? (JSON.parse(io.out) as Record<string, any>) : null };
}

function repo(): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, {
    'package.json': JSON.stringify({ name: 'app', private: true, dependencies: { next: '15.5.0' } }),
    'lib/util.ts': 'export const add = (a: number, b: number) => a + b;\n',
    '.gitignore': 'node_modules\n.env.local\n',
  });
  commitAll(dir, 'init');
  return dir;
}

const KEY = () => expandFakeKeys('{{fake:openai-project:7}}');

describe('claude hooks', () => {
  test('a session: start, deny a key write, feedback after an edit, stop gate, then a clean stop', async () => {
    const dir = repo();
    const base = { session_id: 'sess-1', cwd: dir, transcript_path: '/tmp/t.jsonl' };

    const start = await hook(dir, 'claude', 'SessionStart', { ...base, hook_event_name: 'SessionStart', source: 'startup' });
    assert.equal(start.code, 0);
    assert.equal(start.json?.hookSpecificOutput?.hookEventName, 'SessionStart');
    assert.match(start.json?.hookSpecificOutput?.additionalContext, /Ubon is active/);

    // A key about to be written to a tracked source file is denied before it reaches disk.
    const key = KEY();
    const pre = await hook(dir, 'claude', 'PreToolUse', {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 'toolu_1',
      tool_input: { file_path: join(dir, 'lib/openai.ts'), content: `export const key = '${key}';\n` },
    });
    assert.equal(pre.json?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(pre.json?.hookSpecificOutput?.permissionDecisionReason, /OpenAI API key/);
    assert.ok(!pre.out.includes(key), 'the raw key must never appear in hook output');

    // The same key into an ignored env file is fine.
    const envWrite = await hook(dir, 'claude', 'PreToolUse', {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 'toolu_2',
      tool_input: { file_path: join(dir, '.env.local'), content: `OPENAI_API_KEY=${key}\n` },
    });
    assert.equal(envWrite.out, '');

    // The agent writes the key anyway through a shell command; the edit hook for another file and the stop gate still see it.
    writeFileSync(join(dir, 'lib/openai.ts'), `export const key = '${key}';\n`);
    const post = await hook(dir, 'claude', 'PostToolUse', {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_use_id: 'toolu_3',
      tool_input: { file_path: join(dir, 'lib/openai.ts'), old_string: 'a', new_string: 'b' },
      tool_response: { filePath: join(dir, 'lib/openai.ts'), success: true },
    });
    assert.equal(post.json?.decision, 'block');
    assert.match(post.json?.reason, /BLOCK secret\/provider-key lib\/openai\.ts:1/);
    assert.ok(!post.out.includes(key));

    const stop1 = await hook(dir, 'claude', 'Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false });
    assert.equal(stop1.json?.decision, 'block');
    assert.match(stop1.json?.reason, /secret\/provider-key/);

    // Fixed: the stop is allowed.
    writeFileSync(join(dir, 'lib/openai.ts'), 'export const key = process.env.OPENAI_API_KEY;\n');
    const stop2 = await hook(dir, 'claude', 'Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: true });
    assert.equal(stop2.out, '');

    const log = readEvents(dir, 'sess-1');
    assert.deepEqual(
      log.map((e) => `${e.event}:${e.decision}`),
      ['SessionStart:context', 'PreToolUse:deny', 'PreToolUse:allow', 'PostToolUse:feedback', 'Stop:continue', 'Stop:allow'],
    );
    assert.ok(!JSON.stringify(log).includes(key), 'the session log must not contain the key');
  });

  test('changes that existed before the session started do not block the stop', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'lib/old.ts'), `export const legacy = '${KEY()}';\n`); // uncommitted work from before the session
    const base = { session_id: 'sess-2', cwd: dir };
    await hook(dir, 'claude', 'SessionStart', { ...base, hook_event_name: 'SessionStart', source: 'startup' });
    writeFileSync(join(dir, 'lib/util.ts'), 'export const add = (a: number, b: number) => a + b + 0;\n');
    const stop = await hook(dir, 'claude', 'Stop', { ...base, hook_event_name: 'Stop' });
    assert.equal(stop.out, '', stop.out);
  });

  test('the loop guard lets the agent stop after two blocks for the same findings', async () => {
    const dir = repo();
    const base = { session_id: 'sess-3', cwd: dir };
    await hook(dir, 'claude', 'SessionStart', { ...base, hook_event_name: 'SessionStart', source: 'startup' });
    writeFileSync(join(dir, 'lib/openai.ts'), `export const key = '${KEY()}';\n`);
    const a = await hook(dir, 'claude', 'Stop', { ...base, hook_event_name: 'Stop' });
    const b = await hook(dir, 'claude', 'Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: true });
    const c = await hook(dir, 'claude', 'Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: true });
    assert.equal(a.json?.decision, 'block');
    assert.equal(b.json?.decision, 'block');
    assert.equal(c.json?.decision, undefined);
    assert.match(c.json?.systemMessage, /unresolved/);
    const last = readEvents(dir, 'sess-3').at(-1);
    assert.equal(last?.unresolved?.[0]?.rule, 'secret/provider-key');
  });

  test('a prompt with a provider key is blocked and the key is not echoed', async () => {
    const dir = repo();
    const key = KEY();
    const r = await hook(dir, 'claude', 'UserPromptSubmit', { session_id: 's4', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: `use this key ${key} please` });
    assert.equal(r.json?.decision, 'block');
    assert.match(r.json?.reason, /OpenAI API key/);
    assert.ok(!r.out.includes(key));
  });

  test('a repeated event with the same tool_use_id gets the same answer', async () => {
    const dir = repo();
    const payload = {
      session_id: 's5',
      cwd: dir,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 'toolu_same',
      tool_input: { file_path: join(dir, 'a.ts'), content: `const k = '${KEY()}'` },
    };
    const first = await hook(dir, 'claude', 'PreToolUse', payload);
    const second = await hook(dir, 'claude', 'PreToolUse', payload);
    assert.equal(first.out, second.out);
    assert.equal(readEvents(dir, 's5').length, 1);
  });

  test('broken input fails open with a visible notice', async () => {
    const dir = repo();
    const io = memoryIO(dir, '{not json');
    const code = await runHook(['claude', 'PreToolUse'], io);
    assert.equal(code, 0);
    assert.match(JSON.parse(io.out).systemMessage, /hook error .*action allowed/);
  });

  test('an unknown agent or event never blocks', async () => {
    const dir = repo();
    const io = memoryIO(dir, '{}');
    assert.equal(await runHook(['nope', 'PreToolUse'], io), 0);
    assert.equal(await runHook(['claude', 'PostToolUSe'], memoryIO(dir, '{}')), 0);
  });
});

describe('adapters produce each agent\'s exact output shape', () => {
  const keyWrite = (dir: string) => ({ file_path: join(dir, 'x.ts'), content: `const k = '${KEY()}'` });

  test('codex: only documented fields, ask becomes deny, apply_patch is parsed', async () => {
    const dir = repo();
    const patch = `*** Begin Patch\n*** Add File: src/k.ts\n+export const k = '${KEY()}';\n*** End Patch\n`;
    const r = await hook(dir, 'codex', 'PreToolUse', { session_id: 'c1', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_use_id: 'call_1', tool_input: { command: patch } });
    assert.deepEqual(Object.keys(r.json ?? {}), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(r.json?.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
    assert.equal(r.json?.hookSpecificOutput.permissionDecision, 'deny');
    const stop = await hook(dir, 'codex', 'Stop', { session_id: 'c1', cwd: dir, hook_event_name: 'Stop', stop_hook_active: false });
    assert.equal(stop.out, '');
  });

  test('cursor: flat snake_case with the reason in user_message', async () => {
    const dir = repo();
    const r = await hook(dir, 'cursor', 'preToolUse', { conversation_id: 'cu1', workspace_roots: [dir], hook_event_name: 'preToolUse', tool_name: 'Write', tool_input: keyWrite(dir), cwd: '' });
    assert.equal(r.json?.permission, 'deny');
    assert.match(r.json?.user_message, /OpenAI API key/);
    assert.equal(r.json?.hookSpecificOutput, undefined);
    const prompt = await hook(dir, 'cursor', 'beforeSubmitPrompt', { conversation_id: 'cu1', workspace_roots: [dir], hook_event_name: 'beforeSubmitPrompt', prompt: `key ${KEY()}` });
    assert.equal(prompt.json?.continue, false);
  });

  test('gemini: decision deny with reason', async () => {
    const dir = repo();
    const r = await hook(dir, 'gemini', 'BeforeTool', { session_id: 'g1', cwd: dir, hook_event_name: 'BeforeTool', tool_name: 'write_file', tool_input: keyWrite(dir) });
    assert.equal(r.json?.decision, 'deny');
    assert.match(r.json?.reason, /OpenAI API key/);
  });

  test('copilot: top-level and nested fields, camelCase payloads with toolArgs as a string', async () => {
    const dir = repo();
    const r = await hook(dir, 'copilot', 'preToolUse', { sessionId: 'p1', cwd: dir, toolName: 'create', toolArgs: JSON.stringify({ path: join(dir, 'x.ts'), file_text: `const k = '${KEY()}'` }) });
    assert.equal(r.json?.permissionDecision, 'deny');
    assert.equal(r.json?.hookSpecificOutput?.permissionDecision, 'deny');
    const vs = await hook(dir, 'copilot', 'PreToolUse', { session_id: 'p1', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'create_file', tool_input: { filePath: join(dir, 'y.ts'), content: `const k = '${KEY()}'` } });
    assert.equal(vs.json?.hookSpecificOutput?.permissionDecision, 'deny');
  });
});

describe('hook start-up cost', () => {
  test('the rule ID list that hooks use matches the rules', () => {
    assert.deepEqual([...RULE_IDS], RULES.map((r) => r.meta.id));
  });

  test('a hook for a shell command loads neither the rules nor the parsers', () => {
    const dir = tempDir();
    initRepo(dir);
    // A module resolution hook in the child process reports what it loads.
    const tracer = `export async function resolve(specifier, context, next) {
      const result = await next(specifier, context);
      if (/\\/src\\/rules\\/index\\.ts$|@babel\\/parser|\\/node_modules\\/yaml\\//.test(result.url)) process.stderr.write('LOADED ' + result.url + '\\n');
      return result;
    }`;
    const register = `import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(tracer)}`)});`;
    const main = pathToFileURL(join(import.meta.dirname, '../src/cli/main.ts')).href;
    const payload = JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const run = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(register)}`, '--input-type=module', '-e', `const { main } = await import(${JSON.stringify(main)}); process.exitCode = await main(['hook', 'claude', 'PreToolUse']);`], { cwd: dir, input: payload, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr, /LOADED/);
  });
});
