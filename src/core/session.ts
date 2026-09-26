import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { changedSince, gitDir, hashFiles, headCommit, listRepoFiles } from './git.ts';

/**
 * Agent session state. Stored in the git directory (`.git/ubon/sessions/`),
 * which is never committed or pushed. Outside git it goes to the user cache
 * directory. Nothing here holds file contents: the session start record keeps
 * git blob ids for files that were already dirty (the blobs themselves go to
 * the object database, where git's garbage collection removes them later).
 */

export interface SessionRecord {
  version: 1;
  id: string;
  agent: string;
  /** ISO time the session started. */
  started: string;
  /** HEAD at session start (null on a branch with no commits, or outside git). */
  head: string | null;
  /** Files that differed from HEAD at session start: path -> blob id, or null when the file was deleted. */
  dirty: Record<string, string | null>;
  /** Dirty files that were too large to snapshot; changes to them are compared with HEAD. */
  skipped: string[];
}

export interface SessionEvent {
  at: string;
  agent: string;
  event: string;
  tool?: string;
  /** allow, deny, ask, block, context, error, unresolved */
  decision: string;
  rules?: string[];
  /** Hash of the blocking findings, for the stop loop guard. */
  findings?: string;
  /** Unresolved findings recorded when the loop guard lets the agent stop. */
  unresolved?: Array<{ rule: string; file: string; line: number; fingerprint: string }>;
  /** Files an agent edited or created (recorded after edits, used when there is no git base). */
  files?: string[];
  /** Tool call identifier, for idempotency. */
  key?: string;
  ms?: number;
  note?: string;
}

const MAX_SNAPSHOT_FILES = 5000;

export function sanitizeSessionId(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  if (/^[A-Za-z0-9._-]{1,100}$/.test(text) && !/^\.+$/.test(text)) return text;
  if (text.length === 0) return 'default';
  return `h-${createHash('sha256').update(text).digest('hex').slice(0, 24)}`;
}

/** Directory for this project's Ubon state. */
export function stateDir(root: string): string {
  const dir = gitDir(root);
  if (dir) return join(dir, 'ubon');
  const cacheBase = process.env.XDG_CACHE_HOME || (process.platform === 'win32' ? process.env.LOCALAPPDATA : null) || join(homedir(), '.cache');
  const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return join(cacheBase as string, 'ubon', 'projects', key);
}

function sessionsDir(root: string): string {
  return join(stateDir(root), 'sessions');
}

export function recordPath(root: string, id: string): string {
  return join(sessionsDir(root), `${sanitizeSessionId(id)}.json`);
}

export function logPath(root: string, id: string): string {
  return join(sessionsDir(root), `${sanitizeSessionId(id)}.log.jsonl`);
}

/**
 * Record the state at session start. Dirty and untracked files are hashed and
 * written to the object database so the Stop check can diff against them.
 */
export function startSession(root: string, id: string, agent: string, maxFileSize: number, now = new Date()): SessionRecord {
  const safeId = sanitizeSessionId(id);
  const head = headCommit(root);
  const dirty: Record<string, string | null> = {};
  const skipped: string[] = [];
  const isGit = gitDir(root) !== null;
  if (isGit) {
    const changes = head ? changedSince(root, head) ?? [] : (listRepoFiles(root) ?? []).map((path) => ({ path, status: 'added' as const, oldPath: undefined }));
    const toHash: string[] = [];
    for (const change of changes.slice(0, MAX_SNAPSHOT_FILES)) {
      if (change.status === 'deleted') {
        dirty[change.path] = null;
        continue;
      }
      if (change.status === 'renamed' && change.oldPath) dirty[change.oldPath] = null;
      const size = fileSize(join(root, change.path));
      if (size === null) continue;
      if (size > maxFileSize) {
        skipped.push(change.path);
        continue;
      }
      toHash.push(change.path);
    }
    if (changes.length > MAX_SNAPSHOT_FILES) for (const c of changes.slice(MAX_SNAPSHOT_FILES)) skipped.push(c.path);
    const hashes = hashFiles(root, toHash, true);
    for (const path of toHash) {
      const id2 = hashes.get(path);
      if (id2) dirty[path] = id2;
      else skipped.push(path);
    }
  }
  const record: SessionRecord = { version: 1, id: safeId, agent, started: now.toISOString(), head, dirty, skipped: skipped.sort() };
  writeJsonAtomic(recordPath(root, safeId), record);
  pruneOldSessions(root, now);
  return record;
}

export function loadSession(root: string, id: string): SessionRecord | null {
  const path = recordPath(root, id);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SessionRecord;
    if (raw && raw.version === 1 && typeof raw.dirty === 'object' && raw.dirty !== null) return raw;
  } catch {
    // corrupt record: treated as missing
  }
  return null;
}

export function appendEvent(root: string, id: string, event: SessionEvent): void {
  try {
    const path = logPath(root, id);
    mkdirSync(join(path, '..'), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  } catch {
    // The log is best effort; a read-only git directory must not break a hook.
  }
}

export function readEvents(root: string, id: string, limit = 2000): SessionEvent[] {
  const path = logPath(root, id);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const out: SessionEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as SessionEvent);
      } catch {
        // skip a torn line
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Most recently modified session records, newest first. */
export function recentSessions(root: string, limit = 10): Array<{ id: string; modified: Date }> {
  const dir = sessionsDir(root);
  if (!existsSync(dir)) return [];
  const out: Array<{ id: string; modified: Date }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const full = join(dir, name);
    const logFull = full.replace(/\.json$/, '.log.jsonl');
    const stats = [full, logFull].map((p) => (existsSync(p) ? statSync(p).mtime : new Date(0)));
    const modified = stats.reduce((a, b) => (a > b ? a : b));
    out.push({ id: name.slice(0, -'.json'.length), modified });
  }
  return out.sort((a, b) => b.modified.getTime() - a.modified.getTime()).slice(0, limit);
}

const MAX_SESSION_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function pruneOldSessions(root: string, now: Date): void {
  try {
    const dir = sessionsDir(root);
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (now.getTime() - statSync(full).mtime.getTime() > MAX_SESSION_AGE_MS) rmSync(full, { force: true });
    }
  } catch {
    // best effort
  }
}

function fileSize(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
}

/** Hash of the sorted fingerprints of blocking findings, for the loop guard. */
export function findingsHash(fingerprints: readonly string[]): string {
  return createHash('sha256').update([...fingerprints].sort().join(',')).digest('hex').slice(0, 16);
}
