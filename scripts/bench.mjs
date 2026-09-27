#!/usr/bin/env node
// Measures the performance targets in docs/how-it-works.md against the built
// CLI (run `npm run build` first):
//   - process start plus a hook decision for a shell command
//   - `ubon check` on a 10-file diff
//   - `ubon check --all` on a generated project with 2,000 files
// Prints the median of several runs. With --check, exits with 1 when a median
// is more than twice its target (CI machines vary; the targets are for a laptop).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const bin = join(root, 'dist', 'ubon.mjs');
const check = process.argv.includes('--check');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'b', GIT_AUTHOR_EMAIL: 'b@example.com', GIT_COMMITTER_NAME: 'b', GIT_COMMITTER_EMAIL: 'b@example.com' } });

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function time(fn, runs) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    out.push(performance.now() - start);
  }
  return median(out);
}

const route = (i) => `import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  const rows = await db.query('select * from items where id = $1 and page = ${i}', [id]);
  return NextResponse.json(rows);
}
`;
const component = (i) => `'use client';
import { useState } from 'react';

export function Widget${i}({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return <section onClick={() => setOpen(!open)}>{open ? title : null}</section>;
}
`;

function makeProject(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ubon-bench-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'bench', private: true, dependencies: { next: '15.5.4', react: '19.1.1' } }));
  for (let i = 0; i < files; i++) {
    const sub = i % 2 === 0 ? `app/api/items${i}` : 'components';
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, i % 2 === 0 ? `${sub}/route.ts` : `${sub}/Widget${i}.tsx`), i % 2 === 0 ? route(i) : component(i));
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const results = [];
const run = (args, cwd, input) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, input, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) throw new Error(`ubon ${args.join(' ')} exited with ${r.status}: ${r.stderr}`);
};

{
  const dir = makeProject(10);
  const payload = JSON.stringify({ session_id: 'bench', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  results.push(['hook decision for a shell command', time(() => run(['hook', 'claude', 'PreToolUse'], dir, payload), 15), 150]);
  git(dir, 'checkout', '-q', '-b', 'work');
  for (let i = 0; i < 10; i++) writeFileSync(join(dir, `components/New${i}.tsx`), component(1000 + i));
  results.push(['check on a 10-file diff', time(() => run(['check', '--format', 'json'], dir), 7), 500]);
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = makeProject(2000);
  results.push(['check --all on 2,000 files', time(() => run(['check', '--all', '--format', 'json'], dir), 3), 5000]);
  rmSync(dir, { recursive: true, force: true });
}

let slow = 0;
for (const [name, ms, target] of results) {
  const over = ms > target * 2;
  if (over) slow++;
  console.log(`${name.padEnd(36)} ${String(Math.round(ms)).padStart(6)} ms  (target ${target} ms)${over ? '  more than twice the target' : ''}`);
}
if (check && slow > 0) process.exit(1);
