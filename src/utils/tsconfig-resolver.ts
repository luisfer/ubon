import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, resolve, join } from 'path';

/**
 * Lightweight resolver for TypeScript path aliases, used by the Vibe scanner
 * to avoid flagging `@/lib/db` as a hallucinated import when `tsconfig.json`
 * maps `@/*` to `./*`.
 *
 * Keeps the surface minimal: same-directory `extends` is followed one level,
 * but node-module extends (e.g. `next/tsconfig.json`) are ignored — most
 * Next.js / Vite scaffolds inline their `paths` anyway, and the cost of a
 * miss is simply "flag something that was probably fine," which the existing
 * confidence score already communicates.
 */

interface CompilerOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

interface TsconfigPathsConfig {
  baseUrl: string; // absolute path
  paths: Record<string, string[]>;
}

const cache = new Map<string, TsconfigPathsConfig | null>();

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];

function stripJsonComments(text: string): string {
  // String-aware JSONC stripper. Naive global regexes choke on patterns like
  // `"@/*": ["./*"]` where `/*` / `*/` appear inside string literals.
  let out = '';
  let i = 0;
  let inString = false;
  let stringChar = '';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringChar) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      inString = true;
      stringChar = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function readTsconfigOnce(tsconfigPath: string, seen: Set<string>): CompilerOptions | null {
  if (seen.has(tsconfigPath)) return null;
  seen.add(tsconfigPath);
  if (!existsSync(tsconfigPath)) return null;
  try {
    const raw = readFileSync(tsconfigPath, 'utf-8');
    const parsed = JSON.parse(stripJsonComments(raw));
    const own: CompilerOptions = parsed?.compilerOptions || {};
    const extendsPath: unknown = parsed?.extends;
    if (typeof extendsPath === 'string' && (extendsPath.startsWith('.') || extendsPath.startsWith('/'))) {
      const base = readTsconfigOnce(resolve(dirname(tsconfigPath), extendsPath.endsWith('.json') ? extendsPath : `${extendsPath}.json`), seen);
      if (base) {
        return {
          baseUrl: own.baseUrl ?? base.baseUrl,
          paths: { ...(base.paths || {}), ...(own.paths || {}) }
        };
      }
    }
    return own;
  } catch {
    return null;
  }
}

export function loadTsconfigPaths(directory: string): TsconfigPathsConfig | null {
  const key = resolve(directory);
  if (cache.has(key)) return cache.get(key) ?? null;

  const tsconfigPath = join(key, 'tsconfig.json');
  const co = readTsconfigOnce(tsconfigPath, new Set());
  if (!co || (!co.baseUrl && (!co.paths || Object.keys(co.paths).length === 0))) {
    cache.set(key, null);
    return null;
  }
  const baseUrl = resolve(key, co.baseUrl || '.');
  const paths = co.paths || {};
  const result: TsconfigPathsConfig = { baseUrl, paths };
  cache.set(key, result);
  return result;
}

function candidateExists(base: string): boolean {
  if (existsSync(base)) return true;
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (existsSync(`${base}${ext}`)) return true;
  }
  for (const idx of INDEX_FILES) {
    if (existsSync(join(base, idx))) return true;
  }
  return false;
}

/**
 * Returns true if `specifier` resolves to a real file on disk via the
 * project's tsconfig `paths` / `baseUrl`. Used to suppress VIBE001 false
 * positives on alias imports like `@/lib/db` or `~/components/Foo`.
 */
export function resolvesViaTsconfigPaths(specifier: string, directory: string): boolean {
  const cfg = loadTsconfigPaths(directory);
  if (!cfg) return false;

  // paths can have wildcard patterns like "@/*": ["./src/*"]
  for (const [pattern, targets] of Object.entries(cfg.paths)) {
    const wildcardIdx = pattern.indexOf('*');
    if (wildcardIdx === -1) {
      if (specifier !== pattern) continue;
      for (const target of targets) {
        const base = isAbsolute(target) ? target : resolve(cfg.baseUrl, target);
        if (candidateExists(base)) return true;
      }
    } else {
      const prefix = pattern.slice(0, wildcardIdx);
      const suffix = pattern.slice(wildcardIdx + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const target of targets) {
        const resolvedTarget = target.replace('*', captured);
        const base = isAbsolute(resolvedTarget) ? resolvedTarget : resolve(cfg.baseUrl, resolvedTarget);
        if (candidateExists(base)) return true;
      }
    }
  }

  // Fall back to bare baseUrl resolution: `import X from "lib/db"` where
  // baseUrl is `src/` and `src/lib/db.ts` exists.
  if (cfg.baseUrl) {
    const base = resolve(cfg.baseUrl, specifier);
    if (candidateExists(base)) return true;
  }
  return false;
}
