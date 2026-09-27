import { join, posix } from 'node:path';
import { readTextFile } from '../../core/files.ts';
import type { Project } from '../../core/project.ts';
import type { ProjectContext } from '../types.ts';
import { type LockEntry, type Lockfile, type SourceKind, entryKey, lockfileKind, parseLockfile } from './lockfile.ts';
import { type DependencyChange, dependencyChanges, isManifestPath } from './manifest.ts';

/**
 * What changed in dependencies since the base, shared by the deps rules in
 * one run: dependencies added or changed in each package.json, and entries
 * that are new in each lockfile. In --all audits and path checks there is no
 * base, so nothing is new.
 */

export interface ManifestDiff {
  path: string;
  changes: DependencyChange[];
}

export interface LockfileDiff {
  path: string;
  lock: Lockfile;
  /** Entries whose name@version is not in any lockfile at the base. */
  added: LockEntry[];
}

export interface DepsDiff {
  manifests: ManifestDiff[];
  lockfiles: LockfileDiff[];
  /** Names in any lockfile at the base, with where they came from. */
  baseSources: Map<string, Set<SourceKind>>;
  /** name@version pairs in any lockfile at the base. */
  baseVersions: Set<string>;
  /** Current lockfiles by path (changed or not), for version lookups. */
  currentLocks: Map<string, Lockfile>;
}

const memo = new WeakMap<Project, DepsDiff>();

const CHANGED = new Set(['added', 'modified', 'renamed']);

/** Lockfiles are often larger than the engine's file size limit; the deps rules read them up to this size. */
const LOCKFILE_MAX_BYTES = 64 * 1024 * 1024;

function readLockfileText(ctx: ProjectContext, path: string): string | null {
  const text = ctx.read(path);
  if (text !== null) return text;
  const read = readTextFile(join(ctx.project.root, path), LOCKFILE_MAX_BYTES);
  return read.ok ? read.text : null;
}

export function depsDiff(ctx: ProjectContext): DepsDiff {
  const cached = memo.get(ctx.project);
  if (cached) return cached;
  if (ctx.mode === 'all' || ctx.mode === 'paths') {
    const empty: DepsDiff = { manifests: [], lockfiles: [], baseSources: new Map(), baseVersions: new Set(), currentLocks: new Map() };
    memo.set(ctx.project, empty);
    return empty;
  }
  const manifests: ManifestDiff[] = [];
  const lockfiles: LockfileDiff[] = [];
  const baseSources = new Map<string, Set<SourceKind>>();
  const baseVersions = new Set<string>();
  const currentLocks = new Map<string, Lockfile>();
  const inScope = new Map(ctx.scopeFiles.map((f) => [f.path, f]));

  const addBase = (lock: Lockfile | null) => {
    for (const e of lock?.entries ?? []) {
      const set = baseSources.get(e.name) ?? new Set<SourceKind>();
      set.add(e.source);
      baseSources.set(e.name, set);
      baseVersions.add(entryKey(e));
    }
  };

  const changedLocks: Array<{ path: string; lock: Lockfile }> = [];
  for (const view of ctx.scopeFiles) {
    if (!CHANGED.has(view.status) && view.status !== 'deleted') continue;
    if (isManifestPath(view.path) && view.status !== 'deleted') {
      const after = ctx.read(view.path);
      if (after === null) continue;
      const before = view.status === 'added' ? null : ctx.base(view.path);
      if (view.status !== 'added' && before === null) continue; // base unreadable: do not treat everything as new
      manifests.push({ path: view.path, changes: dependencyChanges(before, after) });
      continue;
    }
    if (!lockfileKind(view.path)) continue;
    if (view.status !== 'added') {
      const before = ctx.base(view.path);
      if (before !== null) addBase(parseLockfile(view.path, before));
    }
    if (view.status === 'deleted') continue;
    const text = readLockfileText(ctx, view.path);
    const lock = text === null ? null : parseLockfile(view.path, text);
    if (lock) {
      changedLocks.push({ path: view.path, lock });
      currentLocks.set(view.path, lock);
    }
  }
  // Lockfiles that did not change are the same at the base.
  for (const path of ctx.project.files) {
    if (!lockfileKind(path) || path.includes('node_modules/')) continue;
    const view = inScope.get(path);
    if (view && view.status !== 'unchanged') continue;
    const text = readLockfileText(ctx, path);
    const lock = text === null ? null : parseLockfile(path, text);
    if (!lock) continue;
    addBase(lock);
    currentLocks.set(path, lock);
  }
  for (const { path, lock } of changedLocks) {
    const seen = new Set<string>();
    const added = lock.entries.filter((e) => {
      const key = entryKey(e);
      if (baseVersions.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    lockfiles.push({ path, lock, added });
  }
  const result: DepsDiff = { manifests, lockfiles, baseSources, baseVersions, currentLocks };
  memo.set(ctx.project, result);
  return result;
}

/**
 * The version a lockfile pins for a direct dependency of the package.json at
 * `manifestPath`: from the nearest lockfile at or above its directory.
 */
export function lockedVersion(diff: DepsDiff, manifestPath: string, name: string): string | undefined {
  let dir = posix.dirname(manifestPath);
  const candidates = [...diff.currentLocks.entries()];
  while (true) {
    const key = dir === '.' ? '' : dir;
    for (const [path, lock] of candidates) {
      const lockDir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
      if (lockDir !== key) continue;
      const manifestDir = posix.dirname(manifestPath) === '.' ? '' : posix.dirname(manifestPath);
      const importer = lockDir === '' ? manifestDir : manifestDir.slice(lockDir.length + 1);
      // npm, Yarn, and Bun hoist workspace dependencies to the root node_modules; pnpm lists each importer.
      const version = lock.direct.get(importer)?.get(name) ?? (lock.kind === 'pnpm' ? undefined : lock.direct.get('')?.get(name));
      if (version) return version;
    }
    if (key === '') return undefined;
    dir = posix.dirname(dir);
  }
}

/** Names of workspace packages in the project (never checked as registry packages). */
export function workspaceNames(project: Project): Set<string> {
  const out = new Set<string>();
  for (const p of project.packages.values()) if (p.name) out.add(p.name);
  return out;
}
