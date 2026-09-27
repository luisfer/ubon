import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * A small cache for registry and OSV facts (existence, latest version, publish
 * dates, malicious-package record IDs), so hooks do not repeat lookups. It
 * never holds code, package contents, or anything from the project.
 *
 * Location: $XDG_CACHE_HOME/ubon or ~/.cache/ubon; %LOCALAPPDATA%\ubon on Windows.
 * Entries expire (one day for dates that do not change once published, less
 * for facts that do), and the file is capped at MAX_ENTRIES.
 */

export interface FactCache {
  get(key: string): unknown;
  set(key: string, value: unknown, ttlMs: number): void;
  /** Write pending changes; never throws. */
  save(): void;
}


const MAX_ENTRIES = 5000;
const FILE = 'registry-facts.json';
const FORMAT = 1;

interface Entry {
  /** Expiry time in ms since the epoch. */
  e: number;
  v: unknown;
}

export function cacheDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = safeHome()): string {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : join(home, 'AppData', 'Local');
    return join(local, 'ubon');
  }
  const xdg = env.XDG_CACHE_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, '.cache'), 'ubon');
}

function safeHome(): string {
  try {
    return homedir();
  } catch {
    return '.';
  }
}

export class MemoryCache implements FactCache {
  protected entries = new Map<string, Entry>();
  protected readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.e <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.v;
  }
  set(key: string, value: unknown, ttlMs: number): void {
    this.entries.set(key, { e: this.now() + ttlMs, v: value });
  }
  save(): void {
    // nothing to persist
  }
}

export class FileCache extends MemoryCache {
  private readonly dir: string;
  private loaded = false;
  private dirty = false;
  constructor(dir: string = cacheDir(), now: () => number = Date.now) {
    super(now);
    this.dir = dir;
  }
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = JSON.parse(readFileSync(join(this.dir, FILE), 'utf8')) as { format?: number; entries?: Record<string, Entry> };
      if (data.format !== FORMAT || !data.entries || typeof data.entries !== 'object') return;
      const now = this.now();
      for (const [key, entry] of Object.entries(data.entries)) {
        if (entry && typeof entry.e === 'number' && entry.e > now) this.entries.set(key, entry);
      }
    } catch {
      // missing or unreadable: start empty
    }
  }
  override get(key: string): unknown {
    this.load();
    return super.get(key);
  }
  override set(key: string, value: unknown, ttlMs: number): void {
    this.load();
    super.set(key, value, ttlMs);
    this.dirty = true;
  }
  override save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const now = this.now();
      const live = [...this.entries.entries()].filter(([, entry]) => entry.e > now);
      live.sort((a, b) => b[1].e - a[1].e);
      const entries = Object.fromEntries(live.slice(0, MAX_ENTRIES));
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const target = join(this.dir, FILE);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ format: FORMAT, entries }), { mode: 0o600 });
      renameSync(temp, target);
    } catch {
      // a read-only home or a full disk only costs repeated lookups
    }
  }
}
