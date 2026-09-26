import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInit } from '../src/cli/init.ts';
import { isIgnored } from '../src/core/git.ts';
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

test('replaces what Ubon 3 installed and keeps the user files next to it', async () => {
  const v3Section = (heading: string) =>
    `# ${heading}\n\n## Ubon\n\n- Run \`ubon verify\` before considering implementation work complete.\n- For fast inner-loop checks, run \`ubon check --preset agent\`.\n- For PR review, run \`ubon review --since origin/main\`.\n- Do not ignore high-severity Ubon findings unless there is an explicit suppression reason.\n`;
  const dir = project({
    '.cursor/hooks.json': JSON.stringify({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: '.cursor/hooks/ubon-after-edit.sh' }, { command: './scripts/format.sh' }],
        stop: [{ command: '.cursor/hooks/ubon-stop-gate.sh' }],
        preCompact: [{ command: '.cursor/hooks/ubon-precompact.sh' }],
      },
    }),
    '.cursor/hooks/ubon-after-edit.sh': '#!/bin/bash\n',
    '.cursor/hooks/ubon-stop-gate.sh': '#!/bin/bash\n',
    '.cursor/hooks/ubon-precompact.sh': '#!/bin/bash\n',
    '.cursor/hooks/mine.sh': '#!/bin/bash\n',
    '.cursor/rules/ubon.mdc': '---\ndescription: Ubon security scanner integration\nglobs: ["**/*.ts"]\n---\n\n# Ubon\n',
    'AGENTS.md': v3Section('Agent guidance'),
    'CLAUDE.md': v3Section('Claude Code guidance'),
    '.pre-commit-config.yaml':
      'repos:\n  - repo: local\n    hooks:\n      - id: ubon-security-check\n        name: Ubon Security Scanner\n        entry: ubon check --git-changed-since HEAD --fast --fail-on error\n        language: system\n        files: \\\\.(js|jsx|ts|tsx|svelte|astro)$\n        pass_filenames: false\n',
    '.github/workflows/ubon.yml': 'name: Ubon\n\non:\n  pull_request:\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx ubon@latest verify\n',
    '.gitignore': 'node_modules/\n.ubon/\n',
    'ubon.config.json': '{"failOn":"error"}\n',
  });
  writeFiles(dir, { '.ubon/results-cache.json': '{}' });
  const io = memoryIO(dir);
  assert.equal(await runInit(['--cursor', '--yes'], io), 0);

  const hooks = JSON.parse(readFileSync(join(dir, '.cursor/hooks.json'), 'utf8'));
  const commands = Object.values(hooks.hooks as Record<string, Array<{ command: string }>>).flat().map((h) => h.command);
  assert.equal(commands.some((c) => c.includes('ubon-')), false, 'no Ubon 3 script left in hooks.json');
  assert.ok(commands.includes('./scripts/format.sh'), 'the user hook is kept');
  assert.ok(commands.some((c) => c.includes('ubon hook cursor')));
  assert.equal(existsSync(join(dir, '.cursor/hooks/ubon-after-edit.sh')), false);
  assert.equal(existsSync(join(dir, '.cursor/hooks/mine.sh')), true);
  assert.equal(existsSync(join(dir, '.cursor/rules/ubon.mdc')), false);

  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(agents.includes('ubon verify'), false);
  assert.match(agents, /ubon:begin/);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.match(readFileSync(join(dir, '.pre-commit-config.yaml'), 'utf8'), /^repos:\n {2}- repo: https:\/\/github\.com\/luisfer\/ubon\n/);
  assert.match(readFileSync(join(dir, '.github/workflows/ubon.yml'), 'utf8'), /^# Generated by ubon init/);
  assert.equal(existsSync(join(dir, '.ubon/results-cache.json')), false);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n.ubon/*\n!.ubon/baseline.json\n');
  assert.equal(isIgnored(dir, '.ubon/baseline.json'), false, 'the baseline is not ignored');
  assert.equal(isIgnored(dir, '.ubon/results-cache.json'), true, 'other files in .ubon/ stay ignored');
  assert.match(io.out, /ubon\.config\.json is the Ubon 3 configuration/);

  const again = memoryIO(dir);
  await runInit(['--cursor', '--yes'], again);
  assert.match(again.out, /everything is already set up/);
});
