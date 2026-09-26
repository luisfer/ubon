import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { runCheck } from '../src/core/engine.ts';
import { startSession } from '../src/core/session.ts';
import { fakeKey } from './support/fake-keys.ts';
import { commitAll, git, initRepo, tempDir, writeFiles } from './support/fixtures.ts';

/** Which files a check looks at, in the git situations agents and CI create. */

const KEY = (n: number) => `export const k = '${fakeKey('openai-project', 100 + n)}';\n`;

function base(): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': '{"name":"s","private":true}', 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
  commitAll(dir, 'base');
  return dir;
}

async function scoped(dir: string, options: Parameters<typeof runCheck>[0] = {}) {
  const { report, scope } = await runCheck({ cwd: dir, ...options });
  return { report, files: scope.files.map((f) => `${f.status}:${f.path}`) };
}

describe('scope', () => {
  test('untracked files are part of the diff', async () => {
    const dir = base();
    writeFileSync(join(dir, 'src/new.ts'), KEY(1));
    const { report, files } = await scoped(dir);
    assert.deepEqual(files, ['added:src/new.ts']);
    assert.equal(report.summary.block, 1);
  });

  test('ignored files are not checked', async () => {
    const dir = base();
    writeFiles(dir, { '.gitignore': 'secret.ts\n', 'secret.ts': KEY(2) });
    const { files } = await scoped(dir);
    assert.deepEqual(files, ['added:.gitignore']);
  });

  test('--staged reads the index, not the working tree', async () => {
    const dir = base();
    writeFileSync(join(dir, 'src/a.ts'), KEY(3));
    git(dir, 'add', 'src/a.ts');
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n'); // fixed in the working tree, not staged
    writeFileSync(join(dir, 'src/b.ts'), KEY(4)); // changed but not staged
    const { report, files } = await scoped(dir, { mode: 'staged' });
    assert.deepEqual(files, ['modified:src/a.ts']);
    assert.equal(report.summary.block, 1, 'the staged content has the key');
  });

  test('renames and deletions', async () => {
    const dir = base();
    renameSync(join(dir, 'src/a.ts'), join(dir, 'src/renamed.ts'));
    rmSync(join(dir, 'src/b.ts'));
    git(dir, 'add', '-A');
    const { files } = await scoped(dir);
    assert.deepEqual(files.sort(), ['deleted:src/b.ts', 'renamed:src/renamed.ts']);
  });

  test('paths with spaces and non-ASCII characters', async () => {
    const dir = base();
    writeFiles(dir, { 'src/my file ñ.ts': KEY(5) });
    const { report, files } = await scoped(dir);
    assert.deepEqual(files, ['added:src/my file ñ.ts']);
    assert.equal(report.findings[0]?.file, 'src/my file ñ.ts');
  });

  test('findings that existed at the base do not block', async () => {
    const dir = tempDir();
    initRepo(dir);
    writeFiles(dir, { 'src/legacy.ts': `${KEY(6)}export const x = 1;\n` });
    commitAll(dir);
    writeFileSync(join(dir, 'src/legacy.ts'), `${KEY(6)}export const x = 2;\n`);
    const { report } = await scoped(dir);
    assert.equal(report.summary.block, 0);
    assert.equal(report.findings[0]?.introduced, false);
    assert.equal(report.findings[0]?.level, 'warn');
  });

  test('a session base: work that was dirty before the session is not blamed on the agent', async () => {
    const dir = base();
    writeFileSync(join(dir, 'src/a.ts'), KEY(7)); // the user's uncommitted work
    const session = startSession(dir, 'scope-test', 'claude', 1024 * 1024);
    writeFileSync(join(dir, 'src/b.ts'), 'export const b = 3;\n'); // the agent's change
    const { report, files } = await scoped(dir, { mode: 'session', session });
    assert.deepEqual(files, ['modified:src/b.ts']);
    assert.equal(report.summary.block, 0);
    writeFileSync(join(dir, 'src/a.ts'), `${KEY(7)}${KEY(8)}`); // the agent adds a second key to that file
    const after = await scoped(dir, { mode: 'session', session });
    assert.deepEqual(after.files.sort(), ['modified:src/a.ts', 'modified:src/b.ts']);
    assert.equal(after.report.summary.block, 1, 'only the new key blocks');
  });

  test('detached HEAD and a repository with no commits', async () => {
    const dir = base();
    git(dir, 'checkout', '-q', '--detach');
    writeFileSync(join(dir, 'src/c.ts'), KEY(9));
    assert.equal((await scoped(dir)).report.summary.block, 1);
    const fresh = tempDir();
    initRepo(fresh);
    writeFiles(fresh, { 'a.ts': KEY(10) });
    const r = await scoped(fresh);
    assert.equal(r.report.summary.block, 1);
    assert.match(r.report.notes.join(' '), /no commits yet/);
  });

  test('a shallow clone without the merge base falls back and says so', async () => {
    const origin = base();
    git(origin, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(origin, 'src/f.ts'), 'export const f = 1;\n');
    commitAll(origin, 'feature');
    const clone = tempDir();
    rmSync(clone, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'feature', `file://${origin}`, clone]);
    writeFileSync(join(clone, 'src/g.ts'), KEY(11));
    const { report } = await runCheck({ cwd: clone, mode: 'diff' });
    assert.equal(report.summary.block, 1);
  });

  test('outside git, every file is checked and the report says why', async () => {
    const dir = tempDir();
    writeFiles(dir, { 'a.ts': KEY(12), 'node_modules/x/index.js': KEY(13) });
    const { report } = await runCheck({ cwd: dir });
    assert.equal(report.scope.mode, 'all');
    assert.equal(report.summary.block, 1, 'node_modules is skipped');
    assert.match(report.notes.join(' '), /not a git repository/);
  });

  test('CRLF files report the same lines as LF files', async () => {
    const dir = base();
    writeFileSync(join(dir, 'src/crlf.ts'), `// one\r\n// two\r\n${KEY(14).replace('\n', '\r\n')}`);
    const { report } = await scoped(dir);
    assert.equal(report.findings[0]?.range.start.line, 3);
  });

  test('an unknown --base is a usage error that names the ref', async () => {
    const dir = base();
    await assert.rejects(runCheck({ cwd: dir, base: 'origin/nope' }), /Cannot resolve --base origin\/nope/);
  });
});
