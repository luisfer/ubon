import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScopeFileView } from '../rules/types.ts';
import { toPosix, walkDirectory } from './files.ts';
import {
  type FileChange,
  changedSince,
  defaultBaseRef,
  hashFiles,
  headCommit,
  isShallow,
  listRepoFiles,
  mergeBase,
  readObjects,
  resolveCommit,
  stagedChanges,
} from './git.ts';
import { matchesAny } from './glob.ts';
import type { SessionRecord } from './session.ts';
import type { ScopeMode } from './types.ts';

/**
 * Which files a check looks at, and what "before" means for each of them.
 *
 * - diff: changes since the merge base with the default branch (or --base),
 *   including staged, unstaged, and untracked files.
 * - session: changes since an agent session started, using the session start record.
 * - staged: what `git commit` would record, read from the index.
 * - all: every file (tracked plus untracked, not ignored).
 * - paths: the given files, checked in full.
 */

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface ScopeRequest {
  root: string;
  git: boolean;
  mode: ScopeMode;
  base?: string;
  /** Files for 'paths' mode; in other modes, an optional filter. */
  paths?: string[];
  session?: SessionRecord | null;
  ignore: readonly string[];
}

export interface Scope {
  mode: ScopeMode;
  root: string;
  git: boolean;
  /** The base as a label: a ref name, 'HEAD', or 'session start'. */
  baseLabel?: string;
  baseCommit?: string;
  files: ScopeFileView[];
  allFiles: string[];
  notes: string[];
  /** Content from the index in staged mode; undefined means read the working tree. */
  currentText(path: string): string | null | undefined;
  /** Content at the base for a changed file (null when it did not exist). */
  baseText(path: string): string | null;
}

const ALWAYS_SKIP = /(^|\/)(node_modules|\.git)\//;

export function resolveScope(req: ScopeRequest): Scope {
  const notes: string[] = [];
  const allFiles = listAllFiles(req.root, req.git).filter((p) => !ALWAYS_SKIP.test(p));
  const ignored = (p: string) => req.ignore.length > 0 && matchesAny(p, req.ignore);
  const filter = req.mode !== 'paths' && req.paths && req.paths.length > 0 ? new Set(req.paths.map(normalizeRel)) : null;

  let mode = req.mode;
  if (!req.git && (mode === 'diff' || mode === 'staged' || mode === 'session')) {
    if (mode === 'staged') throw new UsageError('--staged needs a git repository.');
    notes.push('not a git repository, so every file was checked');
    mode = 'all';
  }

  const baseObjects = new Map<string, string>(); // path -> object name for base content
  const currentObjects = new Map<string, string>(); // staged mode: path -> index object name
  let files: ScopeFileView[] = [];
  let base: string | undefined;
  let baseCommit: string | undefined;

  if (mode === 'all') {
    files = allFiles.map((path) => ({ path, status: 'unchanged' as const }));
  } else if (mode === 'paths') {
    for (const raw of req.paths ?? []) {
      const path = normalizeRel(raw);
      if (!existsSync(join(req.root, path))) throw new UsageError(`No such file: ${raw}`);
      files.push({ path, status: 'unchanged' });
    }
    // A directory argument expands to the files under it.
    files = files.flatMap((f) => {
      if (allFiles.includes(f.path)) return [f];
      const prefix = f.path === '' || f.path === '.' ? '' : `${f.path.replace(/\/$/, '')}/`;
      const under = allFiles.filter((p) => p.startsWith(prefix));
      return under.length > 0 ? under.map((p) => ({ path: p, status: 'unchanged' as const })) : [f];
    });
  } else if (mode === 'staged') {
    const head = headCommit(req.root);
    const changes = stagedChanges(req.root);
    if (changes === null) throw new UsageError('Could not read the staged changes from git.');
    base = head ? 'HEAD' : undefined;
    baseCommit = head ?? undefined;
    for (const c of changes) {
      files.push(view(c));
      if (c.status !== 'deleted') currentObjects.set(c.path, `:${c.path}`);
      if (head && (c.status === 'modified' || c.status === 'renamed' || c.status === 'deleted')) baseObjects.set(c.path, `${head}:${c.oldPath ?? c.path}`);
    }
  } else if (mode === 'session' && req.session) {
    const session = req.session;
    base = 'session start';
    baseCommit = session.head ?? undefined;
    const changes: FileChange[] = session.head ? changedSince(req.root, session.head) ?? [] : allFiles.map((path) => ({ path, status: 'added' as const }));
    const byPath = new Map(changes.map((c) => [c.path, c]));
    // Files that were dirty at session start but now match HEAD also changed during the session.
    for (const path of Object.keys(session.dirty)) {
      if (!byPath.has(path) && existsSync(join(req.root, path))) byPath.set(path, { path, status: 'modified' });
    }
    const candidates = [...byPath.values()];
    const currentHashes = hashFiles(
      req.root,
      candidates.filter((c) => c.status !== 'deleted' && Object.hasOwn(session.dirty, c.path)).map((c) => c.path),
      false,
    );
    for (const c of candidates) {
      const recorded = Object.hasOwn(session.dirty, c.path) ? session.dirty[c.path] : undefined;
      if (recorded !== undefined) {
        // The file was already dirty when the session started: compare with that snapshot.
        if (c.status === 'deleted') {
          if (recorded === null) continue; // deleted before the session and still deleted
          files.push({ path: c.path, status: 'deleted' });
          baseObjects.set(c.path, recorded);
          continue;
        }
        if (recorded !== null && currentHashes.get(c.path) === recorded) continue; // unchanged during the session
        if (recorded === null) {
          files.push({ path: c.path, status: 'added' });
        } else {
          files.push({ path: c.path, status: 'modified' });
          baseObjects.set(c.path, recorded);
        }
        continue;
      }
      if (session.skipped.includes(c.path)) notes.push(`${c.path} was too large to snapshot at session start; it was compared with HEAD`);
      files.push(view(c));
      if (session.head && (c.status === 'modified' || c.status === 'renamed' || c.status === 'deleted')) {
        baseObjects.set(c.path, `${session.head}:${c.oldPath ?? c.path}`);
      }
    }
  } else {
    // diff (and session without a start record)
    const noRecord = mode === 'session';
    if (noRecord) {
      notes.push('no session start record (Ubon was not active when the session started), so changes since HEAD were checked');
      mode = 'diff';
    }
    const head = headCommit(req.root);
    let resolved: string | null = null;
    if (noRecord) {
      resolved = head;
      base = head ? 'HEAD' : undefined;
    } else if (req.base) {
      const target = resolveCommit(req.root, req.base);
      if (!target) throw new UsageError(`Cannot resolve --base ${req.base}. Fetch it first (in CI, check out with fetch-depth: 0).`);
      resolved = head ? mergeBase(req.root, req.base) : null;
      if (!resolved) {
        resolved = target;
        if (head) notes.push(`no merge base with ${req.base}${isShallow(req.root) ? ' (shallow clone)' : ''}; compared with ${req.base} directly`);
      }
      base = req.base;
    } else {
      const ref = head ? defaultBaseRef(req.root) : null;
      const mb = ref ? mergeBase(req.root, ref) : null;
      if (ref && mb) {
        resolved = mb;
        base = ref;
      } else if (head) {
        resolved = head;
        base = 'HEAD';
        if (ref && !mb) notes.push(`no merge base with ${ref}${isShallow(req.root) ? ' (shallow clone)' : ''}; compared with HEAD`);
      }
    }
    if (resolved) {
      baseCommit = resolved;
      const changes = changedSince(req.root, resolved);
      if (changes === null) throw new UsageError('Could not compute the changed files with git.');
      for (const c of changes) {
        files.push(view(c));
        if (c.status === 'modified' || c.status === 'renamed' || c.status === 'deleted') baseObjects.set(c.path, `${resolved}:${c.oldPath ?? c.path}`);
      }
    } else {
      // No commits yet: everything is new.
      base = undefined;
      files = allFiles.map((path) => ({ path, status: 'added' as const }));
      notes.push('the repository has no commits yet, so every file was checked as new');
    }
  }

  files = files.filter((f) => !ALWAYS_SKIP.test(f.path) && !ignored(f.path));
  if (filter) files = files.filter((f) => filter.has(f.path));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  let baseCache: Map<string, Buffer | null> | null = null;
  let currentCache: Map<string, Buffer | null> | null = null;
  const root = req.root;
  return {
    mode,
    root,
    git: req.git,
    baseLabel: base,
    baseCommit,
    files,
    allFiles: allFiles.filter((p) => !ignored(p)),
    notes,
    currentText(path: string) {
      const name = currentObjects.get(path);
      if (!name) return undefined;
      if (!currentCache) currentCache = readObjects(root, [...currentObjects.values()]);
      const buf = currentCache.get(name);
      return buf ? buf.toString('utf8') : null;
    },
    baseText(path: string) {
      const name = baseObjects.get(path);
      if (!name) return null;
      if (!baseCache) baseCache = readObjects(root, [...baseObjects.values()]);
      const buf = baseCache.get(name);
      return buf ? buf.toString('utf8') : null;
    },
  };
}

function view(c: FileChange): ScopeFileView {
  return c.oldPath ? { path: c.path, status: c.status, oldPath: c.oldPath } : { path: c.path, status: c.status };
}

function normalizeRel(p: string): string {
  return toPosix(p).replace(/^\.\//, '').replace(/\/+$/, '');
}

function listAllFiles(root: string, isGit: boolean): string[] {
  if (isGit) {
    const files = listRepoFiles(root);
    if (files) return files.filter((p) => existsSync(join(root, p)));
  }
  return walkDirectory(root);
}
