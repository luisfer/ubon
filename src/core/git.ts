import { execFileSync } from 'node:child_process';

/**
 * Git access. Every call uses an argument vector (no shell), disables
 * fsmonitor so repository config cannot make Ubon run a program, and never
 * throws: failures return null so callers can fall back and report it.
 */

const BASE_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'color.ui=false'];

/**
 * GIT_INDEX_FILE and GIT_DIR are kept: inside a pre-commit hook they point at
 * the index that is about to be committed, which is what --staged must read.
 */
function GIT_ENV(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
}

export function git(cwd: string, args: string[], options: { maxBuffer?: number; input?: string } = {}): string | null {
  try {
    return execFileSync('git', [...BASE_ARGS, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
      input: options.input,
      env: GIT_ENV(),
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

export function gitBuffer(cwd: string, args: string[]): Buffer | null {
  try {
    return execFileSync('git', [...BASE_ARGS, ...args], {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: GIT_ENV(),
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string | null {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out ? out.trim() : null;
}

export function gitDir(root: string): string | null {
  const out = git(root, ['rev-parse', '--absolute-git-dir']);
  return out ? out.trim() : null;
}

export function resolveCommit(root: string, ref: string): string | null {
  if (!isSafeRef(ref)) return null;
  const out = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  return out ? out.trim() : null;
}

export function headCommit(root: string): string | null {
  return resolveCommit(root, 'HEAD');
}

/**
 * Refs come from users, configs, and hook payloads. Reject anything that could
 * be read as an option or smuggle a path; revision syntax like HEAD~2 is fine
 * because every call also passes --end-of-options and verifies ^{commit}.
 */
export function isSafeRef(ref: string): boolean {
  return ref.length > 0 && ref.length < 256 && !ref.startsWith('-') && !/[\s\0:]/.test(ref.replace(/\^\{commit\}$/, ''));
}

export function defaultBaseRef(root: string): string | null {
  const symbolic = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (symbolic && resolveCommit(root, symbolic.trim())) return symbolic.trim();
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (resolveCommit(root, candidate)) return candidate;
  }
  return null;
}

export function mergeBase(root: string, ref: string): string | null {
  if (!isSafeRef(ref)) return null;
  const out = git(root, ['merge-base', 'HEAD', '--end-of-options', ref]);
  return out ? out.trim() : null;
}

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  path: string;
  status: ChangeStatus;
  oldPath?: string;
}

/**
 * Files that differ between `base` and the working tree (staged and unstaged),
 * plus untracked files that are not ignored. `base` is a commit.
 */
export function changedSince(root: string, base: string): FileChange[] | null {
  const diff = git(root, ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', '--end-of-options', base, '--']);
  if (diff === null) return null;
  const changes = parseNameStatus(diff);
  const untracked = listUntracked(root) ?? [];
  const seen = new Set(changes.map((c) => c.path));
  for (const path of untracked) if (!seen.has(path)) changes.push({ path, status: 'added' });
  return changes;
}

/** Staged changes only, compared with HEAD (or with nothing on an unborn branch). */
export function stagedChanges(root: string): FileChange[] | null {
  const head = headCommit(root);
  const args = ['diff', '--cached', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv'];
  if (head) args.push('--end-of-options', head, '--');
  const out = git(root, args);
  return out === null ? null : parseNameStatus(out);
}

export function parseNameStatus(out: string): FileChange[] {
  const parts = out.split('\0').filter((p) => p.length > 0);
  const changes: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i] ?? '';
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[++i];
      const path = parts[++i];
      if (path && oldPath) changes.push(kind === 'R' ? { path, oldPath, status: 'renamed' } : { path, status: 'added' });
    } else {
      const path = parts[++i];
      if (!path) continue;
      const status: ChangeStatus = kind === 'A' ? 'added' : kind === 'D' ? 'deleted' : 'modified';
      changes.push({ path, status });
    }
  }
  return changes;
}

export function listUntracked(root: string): string[] | null {
  const out = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return out === null ? null : out.split('\0').filter(Boolean);
}

/** Tracked files plus untracked files that are not ignored. */
export function listRepoFiles(root: string): string[] | null {
  const out = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (out === null) return null;
  return [...new Set(out.split('\0').filter(Boolean))];
}

export function listTracked(root: string): Set<string> | null {
  const out = git(root, ['ls-files', '--cached', '-z']);
  return out === null ? null : new Set(out.split('\0').filter(Boolean));
}

/**
 * Content of a file at a commit, or null when the file did not exist there.
 * Uses cat-file, which never runs textconv or other filters.
 */
export function showFile(root: string, commit: string, path: string): string | null {
  if (!isSafeRef(commit) || path.includes('\0') || path.includes('\n')) return null;
  const buf = gitBuffer(root, ['cat-file', 'blob', `${commit}:${path}`]);
  return buf === null ? null : buf.toString('utf8');
}

/** Content of a file as staged in the index. */
export function showStaged(root: string, path: string): string | null {
  if (path.includes('\0') || path.includes('\n')) return null;
  const buf = gitBuffer(root, ['cat-file', 'blob', `:${path}`]);
  return buf === null ? null : buf.toString('utf8');
}

/**
 * Read many objects in one git process (`cat-file --batch`). Keys are object
 * names such as `<commit>:<path>`, `:<path>` (index), or a blob id. Missing
 * objects map to null. Names containing newlines are skipped.
 */
export function readObjects(root: string, names: readonly string[]): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>();
  const valid = names.filter((n) => n.length > 0 && !n.includes('\n') && !n.includes('\0'));
  for (const n of names) out.set(n, null);
  if (valid.length === 0) return out;
  let buf: Buffer;
  try {
    buf = execFileSync('git', [...BASE_ARGS, 'cat-file', '--batch'], {
      cwd: root,
      input: valid.join('\n') + '\n',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: GIT_ENV(),
      windowsHide: true,
    });
  } catch {
    return out;
  }
  let offset = 0;
  for (const name of valid) {
    const newline = buf.indexOf(10, offset);
    if (newline < 0) break;
    const header = buf.subarray(offset, newline).toString('utf8');
    offset = newline + 1;
    const match = /^([0-9a-f]{40,64}) (\w+) (\d+)$/.exec(header);
    if (!match) continue; // "<name> missing" or "ambiguous"
    const size = Number(match[3]);
    const body = buf.subarray(offset, offset + size);
    offset += size + 1;
    if (match[2] === 'blob') out.set(name, Buffer.from(body));
  }
  return out;
}

/**
 * Hash working tree files as git blobs, without filters, optionally writing
 * them to the object database. Returns path -> blob id; unreadable paths are
 * left out.
 */
export function hashFiles(root: string, paths: readonly string[], write: boolean): Map<string, string> {
  const out = new Map<string, string>();
  const valid = paths.filter((p) => p.length > 0 && !p.includes('\n') && !p.includes('\0'));
  if (valid.length === 0) return out;
  const args = ['hash-object', '--no-filters', ...(write ? ['-w'] : []), '--stdin-paths'];
  const result = git(root, args, { input: valid.join('\n') + '\n' });
  if (result === null) {
    // One unreadable path fails the whole batch; fall back to one call per path.
    if (valid.length === 1) return out;
    for (const p of valid) {
      const single = git(root, ['hash-object', '--no-filters', ...(write ? ['-w'] : []), '--', p]);
      if (single) out.set(p, single.trim());
    }
    return out;
  }
  const lines = result.split('\n').filter(Boolean);
  valid.forEach((p, i) => {
    const id = lines[i];
    if (id) out.set(p, id.trim());
  });
  return out;
}

/** Files changed between two commits. */
export function changedBetween(root: string, from: string, to: string): FileChange[] | null {
  if (!isSafeRef(from) || !isSafeRef(to)) return null;
  const out = git(root, ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', '--end-of-options', from, to, '--']);
  return out === null ? null : parseNameStatus(out);
}

export function isShallow(root: string): boolean {
  const out = git(root, ['rev-parse', '--is-shallow-repository']);
  return out?.trim() === 'true';
}

export function currentAuthor(root: string, commit: string): string | null {
  const out = git(root, ['log', '-1', '--format=%an <%ae>', '--end-of-options', commit]);
  return out ? out.trim() : null;
}
