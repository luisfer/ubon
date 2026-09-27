import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

/** Helpers for tests that build throwaway projects and git repositories. */

export const REPO_ROOT = join(import.meta.dirname, '..', '..');
export const FIXTURES = join(REPO_ROOT, 'fixtures');

export function tempDir(prefix = 'ubon-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ubon Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Ubon Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
// Tests may run inside a git hook of this repository; its variables would redirect our git calls.
delete GIT_ENV.GIT_DIR;
delete GIT_ENV.GIT_INDEX_FILE;
delete GIT_ENV.GIT_WORK_TREE;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function initRepo(dir: string): void {
  git(dir, 'init', '-q');
}

export function commitAll(dir: string, message = 'commit', exclude: readonly string[] = []): void {
  git(dir, 'add', '-A');
  for (const path of exclude) {
    try {
      git(dir, 'rm', '-q', '--cached', '--ignore-unmatch', '--', path);
    } catch {
      // not staged
    }
  }
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Replace the working tree (except .git) with the content of `source`. */
export function replaceTree(dir: string, source: string): void {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue;
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
  copyTree(source, dir);
}

export function copyTree(source: string, target: string): void {
  cpSync(source, target, { recursive: true, force: true });
  // Windows keeps each file's modification time when it copies it, and git decides from size and
  // time whether a file changed: a same-size edit copied over a committed file would look unchanged.
  const now = new Date();
  for (const file of listFilesRecursive(source)) utimesSync(join(target, file), now, now);
}

export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === '.git') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
