import { closeSync, lstatSync, openSync, readdirSync, readSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

export type Lang =
  | 'js'
  | 'jsx'
  | 'ts'
  | 'tsx'
  | 'vue'
  | 'svelte'
  | 'astro'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'markdown'
  | 'sql'
  | 'env'
  | 'shell'
  | 'firebase-rules'
  | 'text';

const EXT_LANG: Record<string, Lang> = {
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  mdc: 'markdown',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  rules: 'firebase-rules',
};

const TEXT_NAMES = new Set(['.cursorrules', '.windsurfrules', '.clinerules', '.npmrc', '.yarnrc', '.pypirc', '.netrc', 'Dockerfile', 'Procfile', 'Makefile']);

export function languageOf(path: string): Lang {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (/^\.env(\..*)?$/.test(base) || base.endsWith('.env')) return 'env';
  if (base === '.mcp.json') return 'json';
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const lang = EXT_LANG[base.slice(dot + 1).toLowerCase()];
    if (lang) return lang;
  }
  if (TEXT_NAMES.has(base)) return 'text';
  return 'text';
}

export const JS_LANGS: ReadonlySet<Lang> = new Set(['js', 'jsx', 'ts', 'tsx']);
export const SCRIPT_LANGS: ReadonlySet<Lang> = new Set(['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro']);

/** Directories never scanned outside git (inside git, .gitignore already decides). */
export const DEFAULT_SKIP_DIRS = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
];

export function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * An absolute path with its symbolic links resolved, also for a file that
 * does not exist yet: the nearest existing ancestor is resolved and the rest
 * appended. macOS links /var and /tmp to /private/..., and git reports the
 * resolved path while agents often report the path through the link.
 */
export function physicalPath(path: string): string {
  const rest: string[] = [];
  let current = path;
  for (let depth = 0; depth < 256; depth++) {
    try {
      return join(realpathSync.native(current), ...rest);
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      rest.unshift(basename(current));
      current = parent;
    }
  }
  return path;
}

/**
 * List files under a directory that is not a git repository. Includes dotfiles
 * (agent config lives in .claude/, .cursor/, .github/), skips the usual build and
 * dependency folders, and does not follow symbolic links.
 */
export function walkDirectory(root: string, limit = 200_000): string[] {
  const skip = new Set(DEFAULT_SKIP_DIRS);
  const out: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0 && out.length < limit) {
    const rel = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(child);
      } else if (entry.isFile()) {
        out.push(child);
      }
    }
  }
  return out.sort();
}

export type ReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'missing' | 'too-large' | 'binary' | 'unreadable' | 'symlink' };

/**
 * Read a text file with a size cap and binary detection. Symbolic links are
 * not followed: a link in a scanned repository could point anywhere on the
 * machine, and its target is checked under its own path if it is in the repo.
 */
export function readTextFile(abs: string, maxBytes: number): ReadResult {
  let size: number;
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return { ok: false, reason: 'symlink' };
    if (!st.isFile()) return { ok: false, reason: 'missing' };
    size = st.size;
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (size > maxBytes) return { ok: false, reason: 'too-large' };
  try {
    if (size > 0 && looksBinary(abs, Math.min(size, 8000))) return { ok: false, reason: 'binary' };
    return { ok: true, text: readFileSync(abs, 'utf8') };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

function looksBinary(abs: string, bytes: number): boolean {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } finally {
    closeSync(fd);
  }
}

export function isBinaryText(text: string): boolean {
  return text.slice(0, 8000).includes('\0');
}

/** Line starts for fast offset to position conversion. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function offsetToPosition(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (starts[lo] as number) + 1 };
}
