import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInit } from '../src/cli/init.ts';
import { commitAll, initRepo, tempDir, writeFiles } from './support/fixtures.ts';
import { memoryIO } from './support/io.ts';

function project(files: Record<string, string> = {}): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': JSON.stringify({ name: 'p', private: true, devDependencies: { ubon: '^4.0.0' } }), ...files });
  commitAll(dir);
  return dir;
}

test('dry run by default: prints changes, writes nothing', async () => {
  const dir = project();
  const io = memoryIO(dir);
  assert.equal(await runInit(['--codex'], io), 0);
  assert.match(io.out, /would create \.codex\/hooks\.json/);
  assert.match(io.out, /Nothing was written/);
  assert.equal(existsSync(join(dir, '.codex/hooks.json')), false);
});

test('merges into existing hook config without touching other entries, and is idempotent', async () => {
  const other = { type: 'command', command: './scripts/format.sh' };
  const dir = project({ '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { PostToolUse: [{ matcher: 'Write', hooks: [other] }] } }) });
  await runInit(['--claude', '--hooks-only', '--yes'], memoryIO(dir));
  const first = readFileSync(join(dir, '.claude/settings.json'), 'utf8');
  const data = JSON.parse(first);
  assert.deepEqual(data.permissions, { allow: ['Bash(npm test)'] });
  assert.equal(data.hooks.PostToolUse.length, 2);
  assert.deepEqual(data.hooks.PostToolUse[0].hooks[0], other);
  assert.equal(data.hooks.PreToolUse[0].hooks[0].command, 'npx --no-install ubon hook claude PreToolUse');
  await runInit(['--claude', '--hooks-only', '--yes'], memoryIO(dir));
  assert.equal(readFileSync(join(dir, '.claude/settings.json'), 'utf8'), first, 'a second run changes nothing');
});

test('never creates CLAUDE.md; adds an @AGENTS.md import when one exists', async () => {
  const a = project();
  await runInit(['--claude', '--yes'], memoryIO(a));
  assert.equal(existsSync(join(a, 'CLAUDE.md')), false);
  assert.match(readFileSync(join(a, 'AGENTS.md'), 'utf8'), /ubon:begin/);
  const b = project({ 'CLAUDE.md': '# Notes\n' });
  await runInit(['--claude', '--yes'], memoryIO(b));
  assert.match(readFileSync(join(b, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m);
});

test('JSON files with comments are left alone with a note', async () => {
  const dir = project({ '.cursor/hooks.json': '{\n  // mine\n  "version": 1,\n  "hooks": {}\n}\n' });
  const io = memoryIO(dir);
  await runInit(['--cursor', '--yes'], io);
  assert.match(io.out, /has comments/);
  assert.match(readFileSync(join(dir, '.cursor/hooks.json'), 'utf8'), /\/\/ mine/);
});

test('without a local install, hooks run a pinned version', async () => {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': '{"name":"p"}' });
  await runInit(['--copilot', '--yes'], memoryIO(dir));
  const hooks = JSON.parse(readFileSync(join(dir, '.github/hooks/ubon.json'), 'utf8'));
  assert.match(hooks.hooks.PreToolUse[0].bash, /^npx -y ubon@\d+\.\d+\.\d+\S* hook copilot PreToolUse$/);
});

test('--remove takes out everything init added and keeps the rest', async () => {
  const dir = project({ 'AGENTS.md': '# Project\n\nRules.\n' });
  await runInit(['--codex', '--claude', '--hooks-only', '--yes'], memoryIO(dir));
  writeFileSync(join(dir, 'ubon.json'), '{}\n');
  await runInit(['--remove', '--yes'], memoryIO(dir));
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8').includes('ubon:begin'), false);
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Rules\./);
  const codex = JSON.parse(readFileSync(join(dir, '.codex/hooks.json'), 'utf8'));
  assert.deepEqual(codex.hooks, {});
  assert.equal(existsSync(join(dir, 'ubon.json')), true);
});
