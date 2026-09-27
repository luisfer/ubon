import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { SERVER_PATH, pathContexts } from './context.ts';
import { commentStyleFor, maskComments } from '../lang/comments.ts';
import { JS_LANGS, SCRIPT_LANGS, languageOf, readTextFile } from './files.ts';

/**
 * Project model: packages, frameworks, path aliases, and the client module
 * graph. Built lazily from the full list of repository files, because a file's
 * context (client or server) depends on files that did not change.
 */

export interface PackageInfo {
  dir: string; // '' for the root
  name?: string;
  deps: Set<string>;
  devDeps: Set<string>;
  allDeps: Set<string>;
  workspaces: string[];
  scripts: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface TsPaths {
  dir: string;
  baseUrl: string | null;
  paths: Array<{ pattern: string; targets: string[] }>;
}

export type Framework =
  | 'next'
  | 'vite'
  | 'react'
  | 'vue'
  | 'svelte'
  | 'sveltekit'
  | 'astro'
  | 'remix'
  | 'react-router'
  | 'nuxt'
  | 'hono'
  | 'express'
  | 'fastify'
  | 'supabase'
  | 'firebase'
  | 'ai-sdk'
  | 'openai'
  | 'anthropic'
  | 'prisma'
  | 'drizzle'
  | 'tanstack-start'
  | 'electron'
  | 'expo';

const FRAMEWORK_DEPS: Array<[Framework, RegExp]> = [
  ['next', /^next$/],
  ['vite', /^vite$/],
  ['react', /^react$/],
  ['vue', /^vue$/],
  ['svelte', /^svelte$/],
  ['sveltekit', /^@sveltejs\/kit$/],
  ['astro', /^astro$/],
  ['remix', /^@remix-run\//],
  ['react-router', /^(@react-router\/|react-router$)/],
  ['nuxt', /^nuxt$/],
  ['hono', /^hono$/],
  ['express', /^express$/],
  ['fastify', /^fastify$/],
  ['supabase', /^@supabase\/(supabase-js|ssr|auth-helpers)/],
  ['firebase', /^firebase(-admin)?$/],
  ['ai-sdk', /^(ai|@ai-sdk\/.+)$/],
  ['openai', /^openai$/],
  ['anthropic', /^@anthropic-ai\/sdk$/],
  ['prisma', /^(@prisma\/client|prisma)$/],
  ['drizzle', /^drizzle-orm$/],
  ['tanstack-start', /^@tanstack\/(react-)?start$/],
  ['electron', /^electron$/],
  ['expo', /^expo$/],
];

const SSR_FRAMEWORKS: Framework[] = ['next', 'sveltekit', 'astro', 'remix', 'react-router', 'nuxt', 'tanstack-start'];

export const IMPORT_RE =
  /(?:^|[^\w$.])(?:import\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s*from\s*)?|export\s*(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*|import\s*\(\s*|require\s*\(\s*)(['"`])([^'"`\n]+)\1/g;

/**
 * Module specifiers imported by a file. With the file's path, comments are
 * masked first, so usage examples in doc comments are not imports.
 */
export function extractImports(text: string, path?: string): string[] {
  const out: string[] = [];
  const code = path === undefined ? text : maskComments(text, commentStyleFor(languageOf(path), path));
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(code))) {
    const spec = m[2];
    if (spec && !spec.includes('${')) out.push(spec);
  }
  return out;
}

/** True when the directive appears in the file's directive prologue (before any statement). */
export function hasDirective(text: string, directive: 'use client' | 'use server'): boolean {
  const n = Math.min(text.length, 4000);
  let i = 0;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === '\uFEFF' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
    } else if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end === -1) return false;
      if (text.slice(i + 1, end) === directive) return true;
      i = end + 1;
      while (i < n && (text[i] === ';' || text[i] === ' ' || text[i] === '\t')) i++;
    } else {
      return false;
    }
  }
  return false;
}

export class Project {
  readonly root: string;
  readonly files: readonly string[];
  private readonly fileSet: Set<string>;
  private readonly maxFileSize: number;
  private readonly textCache = new Map<string, string | null>();
  private packagesCache: Map<string, PackageInfo> | null = null;
  private tsPathsCache: TsPaths[] | null = null;
  private graph: { imports: Map<string, string[]>; importers: Map<string, string[]> } | null = null;
  private clientSet: Set<string> | null = null;

  constructor(root: string, files: readonly string[], maxFileSize = 1024 * 1024) {
    this.root = root;
    this.files = files;
    this.fileSet = new Set(files);
    this.maxFileSize = maxFileSize;
  }

  has(path: string): boolean {
    return this.fileSet.has(path);
  }

  read(path: string): string | null {
    if (this.textCache.has(path)) return this.textCache.get(path) ?? null;
    const result = readTextFile(join(this.root, path), this.maxFileSize);
    const text = result.ok ? result.text : null;
    this.textCache.set(path, text);
    return text;
  }

  /** Let the engine share text it already read (or content from the index for --staged). */
  prime(path: string, text: string | null): void {
    this.textCache.set(path, text);
  }

  get packages(): Map<string, PackageInfo> {
    if (this.packagesCache) return this.packagesCache;
    const map = new Map<string, PackageInfo>();
    for (const file of this.files) {
      if (!/(^|\/)package\.json$/.test(file) || file.includes('node_modules/')) continue;
      const text = this.read(file);
      if (!text) continue;
      try {
        const raw = JSON.parse(text) as Record<string, unknown>;
        const dir = file === 'package.json' ? '' : file.slice(0, -'/package.json'.length);
        map.set(dir, toPackageInfo(dir, raw));
      } catch {
        // invalid package.json: skipped, reported by the deps rules if relevant
      }
    }
    this.packagesCache = map;
    return map;
  }

  /** Nearest package.json at or above the file's directory. */
  packageFor(path: string): PackageInfo | undefined {
    let dir = posix.dirname(path);
    const pkgs = this.packages;
    while (true) {
      const key = dir === '.' ? '' : dir;
      const found = pkgs.get(key);
      if (found) return found;
      if (key === '') return undefined;
      dir = posix.dirname(dir);
    }
  }

  rootPackage(): PackageInfo | undefined {
    return this.packages.get('');
  }

  /** Dependencies visible to a file: its package, the root package, and workspace packages. */
  depsFor(path: string): Set<string> {
    const out = new Set<string>();
    const pkg = this.packageFor(path);
    pkg?.allDeps.forEach((d) => out.add(d));
    this.rootPackage()?.allDeps.forEach((d) => out.add(d));
    for (const p of this.packages.values()) if (p.name) out.add(p.name);
    return out;
  }

  frameworksFor(path: string): Set<Framework> {
    const deps = this.depsFor(path);
    const out = new Set<Framework>();
    for (const dep of deps) for (const [fw, re] of FRAMEWORK_DEPS) if (re.test(dep)) out.add(fw);
    if (!out.has('next') && this.files.some((f) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(f))) out.add('next');
    return out;
  }

  /** A single-page app: bundled for the browser, no server rendering framework. */
  isSpa(path: string): boolean {
    const fw = this.frameworksFor(path);
    if (!fw.has('vite') && !fw.has('expo') && !fw.has('electron')) return false;
    return !SSR_FRAMEWORKS.some((f) => fw.has(f));
  }

  /** src/api/ in a single-page app with no server framework holds fetch wrappers that run in the browser. */
  isSpaBrowserApi(path: string): boolean {
    if (!/(^|\/)src\/api\//.test(path) || !this.isSpa(path)) return false;
    const fw = this.frameworksFor(path);
    return !fw.has('express') && !fw.has('hono') && !fw.has('fastify');
  }

  get tsPaths(): TsPaths[] {
    if (this.tsPathsCache) return this.tsPathsCache;
    const out: TsPaths[] = [];
    for (const file of this.files) {
      if (!/(^|\/)(tsconfig|jsconfig)(\.[\w-]+)?\.json$/.test(file) || file.includes('node_modules/')) continue;
      const parsed = this.readTsConfig(file, 0);
      if (parsed) out.push(parsed);
    }
    this.tsPathsCache = out;
    return out;
  }

  private readTsConfig(file: string, depth: number): TsPaths | null {
    const text = this.read(file);
    if (!text || depth > 3) return null;
    const json = parseJsonLoose(text);
    if (!json) return null;
    const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
    let inherited: TsPaths | null = null;
    if (typeof json.extends === 'string' && json.extends.startsWith('.')) {
      const target = posix.normalize(posix.join(dir, json.extends.endsWith('.json') ? json.extends : `${json.extends}.json`));
      if (this.has(target)) inherited = this.readTsConfig(target, depth + 1);
    }
    const options = (json.compilerOptions ?? {}) as Record<string, unknown>;
    const baseUrl = typeof options.baseUrl === 'string' ? posix.normalize(posix.join(dir, options.baseUrl)) : inherited?.baseUrl ?? null;
    const paths: TsPaths['paths'] = [];
    if (options.paths && typeof options.paths === 'object') {
      const base = baseUrl ?? dir;
      for (const [pattern, targets] of Object.entries(options.paths as Record<string, unknown>)) {
        if (!Array.isArray(targets)) continue;
        paths.push({ pattern, targets: targets.filter((t): t is string => typeof t === 'string').map((t) => posix.normalize(posix.join(base === '.' ? '' : base, t))) });
      }
    } else if (inherited) {
      paths.push(...inherited.paths);
    }
    return { dir, baseUrl, paths };
  }

  /** Resolve an import specifier from a file to a repository file, or null for packages and unknowns. */
  resolveImport(from: string, spec: string): string | null {
    if (spec.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(from), spec));
      return this.resolveFile(base);
    }
    for (const cfg of this.tsPathsFor(from)) {
      for (const { pattern, targets } of cfg.paths) {
        const star = pattern.indexOf('*');
        if (star === -1) {
          if (spec !== pattern) continue;
          for (const t of targets) {
            const hit = this.resolveFile(t);
            if (hit) return hit;
          }
        } else {
          const head = pattern.slice(0, star);
          const tail = pattern.slice(star + 1);
          if (!spec.startsWith(head) || !spec.endsWith(tail)) continue;
          const middle = spec.slice(head.length, spec.length - tail.length);
          for (const t of targets) {
            const hit = this.resolveFile(t.replace('*', middle));
            if (hit) return hit;
          }
        }
      }
      if (cfg.baseUrl !== null) {
        const hit = this.resolveFile(posix.normalize(posix.join(cfg.baseUrl, spec)));
        if (hit) return hit;
      }
    }
    return null;
  }

  /** True when a specifier is handled by a tsconfig path alias (even if the target is missing). */
  isAliased(from: string, spec: string): boolean {
    for (const cfg of this.tsPathsFor(from)) {
      for (const { pattern } of cfg.paths) {
        const star = pattern.indexOf('*');
        if (star === -1 ? spec === pattern : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1))) return true;
      }
    }
    return false;
  }

  private tsPathsFor(from: string): TsPaths[] {
    const all = this.tsPaths;
    // Nearest config directories first.
    return all
      .filter((c) => c.dir === '' || from === c.dir || from.startsWith(`${c.dir}/`))
      .sort((a, b) => b.dir.length - a.dir.length);
  }

  private resolveFile(base: string): string | null {
    const clean = base.replace(/^\.\//, '');
    if (this.fileSet.has(clean)) return clean;
    const withoutJs = clean.replace(/\.(js|jsx|mjs|cjs)$/, '');
    const exts = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs', 'vue', 'svelte', 'astro'];
    for (const ext of exts) if (this.fileSet.has(`${withoutJs}.${ext}`)) return `${withoutJs}.${ext}`;
    for (const ext of exts) if (this.fileSet.has(`${clean}/index.${ext}`)) return `${clean}/index.${ext}`;
    return null;
  }

  private buildGraph(): { imports: Map<string, string[]>; importers: Map<string, string[]> } {
    if (this.graph) return this.graph;
    const imports = new Map<string, string[]>();
    const importers = new Map<string, string[]>();
    for (const file of this.files) {
      if (!SCRIPT_LANGS.has(languageOf(file)) || pathContexts(file).has('generated')) continue;
      const text = this.read(file);
      if (!text) continue;
      const targets: string[] = [];
      for (const spec of extractImports(text, file)) {
        const hit = this.resolveImport(file, spec);
        if (hit) {
          targets.push(hit);
          const list = importers.get(hit) ?? [];
          list.push(file);
          importers.set(hit, list);
        }
      }
      imports.set(file, targets);
    }
    this.graph = { imports, importers };
    return this.graph;
  }

  importersOf(path: string): string[] {
    return this.buildGraph().importers.get(path) ?? [];
  }

  importsOf(path: string): string[] {
    return this.buildGraph().imports.get(path) ?? [];
  }

  /** Files whose code ships to the browser. */
  get clientFiles(): Set<string> {
    if (this.clientSet) return this.clientSet;
    const roots: string[] = [];
    for (const file of this.files) {
      const lang = languageOf(file);
      if (!SCRIPT_LANGS.has(lang)) continue;
      const ctx = pathContexts(file);
      if (ctx.has('generated') || ctx.has('test') || ctx.has('config')) continue;
      if (isClientRoot(this, file, lang)) roots.push(file);
    }
    const graph = this.buildGraph();
    const seen = new Set<string>(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      for (const next of graph.imports.get(file) ?? []) {
        if (seen.has(next) || (SERVER_PATH.test(next) && !this.isSpaBrowserApi(next))) continue;
        const text = this.read(next);
        if (text && hasDirective(text, 'use server')) continue; // Server Action modules stay on the server
        seen.add(next);
        queue.push(next);
      }
    }
    this.clientSet = seen;
    return seen;
  }

  isClient(path: string): boolean {
    return this.clientFiles.has(path);
  }

  /** Code that only runs on the server, by convention or directive. */
  isServer(path: string): boolean {
    if (SERVER_PATH.test(path)) return !this.isSpaBrowserApi(path);
    const text = this.read(path);
    if (!text) return false;
    if (hasDirective(text, 'use server') || /^\s*import\s+['"]server-only['"]/m.test(text)) return true;
    // Next.js App Router: files under app/ without 'use client' are Server Components unless imported by a client file.
    if (/(^|\/)(src\/)?app\//.test(path) && this.frameworksFor(path).has('next') && !this.isClient(path)) return true;
    return false;
  }

  hasFile(pattern: RegExp): boolean {
    return this.files.some((f) => pattern.test(f));
  }

  nodeModulesHas(fromPath: string, pkg: string): boolean | null {
    let dir = posix.dirname(fromPath);
    let sawNodeModules = false;
    while (true) {
      const key = dir === '.' ? '' : dir;
      const nm = join(this.root, key, 'node_modules');
      if (existsSync(nm)) {
        sawNodeModules = true;
        if (existsSync(join(nm, pkg, 'package.json'))) return true;
      }
      if (key === '') break;
      dir = posix.dirname(dir);
    }
    return sawNodeModules ? false : null;
  }
}

function isClientRoot(project: Project, file: string, lang: string): boolean {
  if (SERVER_PATH.test(file) && !project.isSpaBrowserApi(file)) return false;
  const text = project.read(file);
  if (!text) return false;
  if (JS_LANGS.has(lang as never) && hasDirective(text, 'use client')) return true;
  // Vue and Svelte components run in the browser (and during SSR).
  if (lang === 'vue' || lang === 'svelte') return true;
  // Single-page apps: everything under src/ is bundled for the browser.
  if (project.isSpa(file) && /(^|\/)src\//.test(file) && (!/(^|\/)src\/(server|api)\//.test(file) || project.isSpaBrowserApi(file))) return true;
  // Next.js Pages Router pages render in the browser too (data functions are stripped by Next).
  if (/(^|\/)(src\/)?pages\//.test(file) && !/(^|\/)(src\/)?pages\/api\//.test(file) && project.frameworksFor(file).has('next')) return true;
  return false;
}

function toPackageInfo(dir: string, raw: Record<string, unknown>): PackageInfo {
  const keys = (field: string) => new Set(Object.keys((raw[field] as Record<string, unknown> | undefined) ?? {}));
  const deps = keys('dependencies');
  const devDeps = keys('devDependencies');
  const allDeps = new Set([...deps, ...devDeps, ...keys('peerDependencies'), ...keys('optionalDependencies')]);
  let workspaces: string[] = [];
  if (Array.isArray(raw.workspaces)) workspaces = raw.workspaces.filter((w): w is string => typeof w === 'string');
  else if (raw.workspaces && typeof raw.workspaces === 'object' && Array.isArray((raw.workspaces as { packages?: unknown }).packages)) {
    workspaces = ((raw.workspaces as { packages: unknown[] }).packages).filter((w): w is string => typeof w === 'string');
  }
  return {
    dir,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    deps,
    devDeps,
    allDeps,
    workspaces,
    scripts: (raw.scripts as Record<string, string> | undefined) ?? {},
    raw,
  };
}

/** Parse JSON with comments and trailing commas (tsconfig, jsconfig, .vscode files). */
export function parseJsonLoose(text: string): Record<string, any> | null {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    // fall through
  }
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += ch;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out) as Record<string, any>;
  } catch {
    return null;
  }
}
