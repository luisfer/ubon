import type { CallExpression, Function as FunctionNode, Node, TaggedTemplateExpression } from '@babel/types';
import { resolve } from 'node:path';
import { type UbonConfig, loadConfig } from '../core/config.ts';
import { pathContexts } from '../core/context.ts';
import { SCRIPT_LANGS, languageOf, readTextFile, walkDirectory } from '../core/files.ts';
import { gitDir, listRepoFiles, repoRoot } from '../core/git.ts';
import { matchesAny } from '../core/glob.ts';
import { safeText } from '../core/mask.ts';
import { Project, hasDirective } from '../core/project.ts';
import { ImportMap, keyName, memberPath, propertyName, stringValue, unwrap } from '../lang/js.ts';
import { parseSource } from '../lang/parse.ts';
import { isFunctionNode, walk } from '../lang/walk.ts';
import { ruleIds } from '../rules/index.ts';
import { isSecretName, publicPrefixOf } from '../rules/secret/names.ts';
import { VERSION } from '../version.ts';

/**
 * `ubon map`: an inventory of the application's entry points and what each
 * one touches. It reports facts for a reviewer (a person or a model) to judge:
 * which handlers call an auth function, which write data, which call models
 * or other services, which env variables they read. It does not decide which
 * routes should be public.
 */

export type EntryKind = 'route-handler' | 'api-route' | 'server-action' | 'form-action' | 'loader' | 'endpoint' | 'trpc' | 'model-tool' | 'mcp-tool';

export interface EntryPoint {
  file: string;
  line: number;
  kind: EntryKind;
  name: string;
  method?: string;
  route?: string;
  auth: string[];
  /** Listed in ubon.json auth.public. */
  declaredPublic: boolean;
  data: string[];
  writes: boolean;
  network: string[];
  models: string[];
  env: string[];
  rateLimit: boolean;
}

export interface MapResult {
  schemaVersion: '4.0';
  tool: { name: 'ubon'; version: string };
  files: number;
  entryPoints: EntryPoint[];
  modelCalls: Array<{ file: string; line: number; call: string }>;
  envVars: Array<{ name: string; files: string[]; secret: boolean; inClientCode: boolean }>;
  notChecked: string[];
}

const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'ALL']);
const AUTH_CALL =
  /(^|[.#])(auth|getServerSession|getSession|getServerAuthSession|currentUser|getUser|getClaims|getAuth|requireAuth|requireUser|requireSession|withAuth|validateRequest|getKindeServerSession|verifySession|getToken|getCurrentUser|getUserOrThrow|getLoggedInUser|authenticate|protect|isAuthenticated|ensureAuth|checkAuth|verifyToken|verifyIdToken|jwtVerify|getSessionFromRequest)$/;
const MODEL_CALL = /(^|[.#])(generateText|generateObject|streamText|streamObject|embed|embedMany)$|chat\.completions\.create$|(^|\.)messages\.(create|stream)$|(^|\.)responses\.create$|(^|\.)generateContent(Stream)?$/;
const DATA_ROOT = /^(prisma|db|database|drizzle|supabase|sql|knex|pool|client|pg|mongoose|kysely|redis|kv|firestore|admin)(\.|$)/;
const WRITE_METHOD = /(^|\.)(insert|insertInto|update|updateTable|upsert|delete|deleteFrom|create|createMany|updateMany|deleteMany|set|push|destroy|save|remove|execute|executeRaw|\$executeRaw|\$executeRawUnsafe|values|rpc|put|hset|del|incr|add|addDoc|setDoc|updateDoc|deleteDoc)$/;
const RATE_LIMIT = /rate_?limit|limiter|throttle|@upstash\/ratelimit|@arcjet|express-rate-limit|hono-rate-limiter/i;

export interface MapOptions {
  cwd: string;
  /** Only map files under this folder (relative to the root). */
  under?: string;
  config?: UbonConfig;
}

export async function buildMap(options: MapOptions): Promise<MapResult> {
  const root = repoRoot(options.cwd) ?? resolve(options.cwd);
  const config = options.config ?? loadConfig(root, ruleIds()).config;
  const all = (gitDir(root) ? listRepoFiles(root) : null) ?? walkDirectory(root);
  const files = all.filter((f) => !/(^|\/)node_modules\//.test(f) && !(config.ignore.length > 0 && matchesAny(f, config.ignore)));
  const project = new Project(root, files, config.maxFileSize);
  const scripts = files.filter((f) => {
    if (!SCRIPT_LANGS.has(languageOf(f))) return false;
    const ctx = pathContexts(f);
    if (ctx.has('generated') || ctx.has('test') || ctx.has('config')) return false;
    return !options.under || f === options.under || f.startsWith(`${options.under.replace(/\/$/, '')}/`);
  });
  const result: MapResult = {
    schemaVersion: '4.0',
    tool: { name: 'ubon', version: VERSION },
    files: scripts.length,
    entryPoints: [],
    modelCalls: [],
    envVars: [],
    notChecked: [],
  };
  const env = new Map<string, { files: Set<string>; client: boolean }>();
  const unparsable: string[] = [];
  const helpers = new HelperIndex(project, config);
  for (const file of scripts) {
    const read = readTextFile(`${root}/${file}`, config.maxFileSize);
    if (!read.ok) continue;
    const text = read.text;
    const parsed = parseSource(text, languageOf(file));
    if (parsed.failed) unparsable.push(file);
    const client = project.isClient(file) && !project.isServer(file);
    for (const block of parsed.blocks) {
      const imports = new ImportMap(block.program);
      helpers.bind(file, imports);
      const serverModule = hasDirective(text, 'use server');
      walk(block.program.program, {
        enter(node, parents) {
          if (node.type === 'MemberExpression') {
            const path = memberPath(node);
            const m = path ? /^(process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path) : null;
            if (m) {
              const name = m[2] as string;
              const entry = env.get(name) ?? { files: new Set<string>(), client: false };
              entry.files.add(file);
              if (client) entry.client = true;
              env.set(name, entry);
            }
          }
          if (node.type === 'CallExpression') {
            const callee = imports.canonical(node.callee as Node) ?? '';
            if (MODEL_CALL.test(callee)) result.modelCalls.push({ file, line: node.loc?.start.line ?? 1, call: shortName(callee) });
          }
          if (!isFunctionNode(node)) return undefined;
          const entry = classify(node as FunctionNode, parents, file, imports, serverModule);
          if (entry) result.entryPoints.push(describe(entry, node as FunctionNode, imports, config, helpers));
          return undefined;
        },
      });
      // Express, Hono, and Fastify routes registered with app.get('/path', handler).
      walk(block.program.program, {
        enter(node) {
          if (node.type !== 'CallExpression') return undefined;
          const call = node as CallExpression;
          const callee = imports.canonical(call.callee as Node) ?? '';
          const m = /(^|\.)(get|post|put|patch|delete|all)$/.exec(callee);
          if (!m || !/^(app|router|api|server|hono|fastify|r)\./.test(callee)) return undefined;
          const route = stringValue(call.arguments[0] as Node);
          if (!route?.startsWith('/')) return undefined;
          const handler = [...call.arguments].reverse().find((a) => isFunctionNode(a as Node)) as FunctionNode | undefined;
          if (!handler) return undefined;
          const method = (m[2] as string).toUpperCase();
          result.entryPoints.push(
            describe({ file, line: call.loc?.start.line ?? 1, kind: 'endpoint', name: `${method} ${route}`, method, route }, handler, imports, config, helpers),
          );
          return undefined;
        },
      });
    }
  }
  result.entryPoints.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  result.envVars = [...env.entries()]
    .map(([name, v]) => ({ name, files: [...v.files].sort(), secret: isSecretName(name), inClientCode: v.client }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  if (unparsable.length > 0) result.notChecked.push(`${unparsable.length} files with syntax errors: ${unparsable.slice(0, 5).join(', ')}`);
  return result;
}

interface EntryDraft {
  file: string;
  line: number;
  kind: EntryKind;
  name: string;
  method?: string;
  route?: string;
}

function classify(fn: FunctionNode, parents: readonly Node[], file: string, imports: ImportMap, serverModule: boolean): EntryDraft | null {
  const parent = parents[parents.length - 1];
  const line = fn.loc?.start.line ?? 1;
  const name = functionName(fn, parent) ?? 'default';
  const exported = isExported(parents);
  const routeFromPath = nextRoute(file);

  if (fn.body.type === 'BlockStatement' && fn.body.directives?.some((d) => d.value.value === 'use server')) {
    return { file, line, kind: 'server-action', name };
  }
  if (serverModule && fn.async && exported) return { file, line, kind: 'server-action', name };
  if (exported && HTTP.has(name)) {
    if (/(^|\/)(app|src\/app)\/(.+\/)?route\.[cm]?[jt]sx?$/.test(file)) return { file, line, kind: 'route-handler', name, method: name, ...(routeFromPath ? { route: routeFromPath } : {}) };
    if (/(^|\/)\+server\.[cm]?[jt]s$/.test(file)) return { file, line, kind: 'endpoint', name, method: name, ...svelteRoute(file) };
    if (/(^|\/)src\/pages\//.test(file)) return { file, line, kind: 'endpoint', name, method: name };
  }
  if (exported && /(^|\/)(pages|src\/pages)\/api\//.test(file) && parent?.type === 'ExportDefaultDeclaration') {
    return { file, line, kind: 'api-route', name: 'default', ...(pagesRoute(file) ? { route: pagesRoute(file) as string } : {}) };
  }
  if (exported && (name === 'loader' || name === 'action' || name === 'load')) {
    return { file, line, kind: name === 'action' ? 'form-action' : 'loader', name, ...(name === 'action' ? { method: 'POST' } : {}) };
  }
  // SvelteKit: export const actions = { default: async (...) => ... }
  if (parent?.type === 'ObjectProperty' || fn.type === 'ObjectMethod') {
    const owner = parents[parents.length - (fn.type === 'ObjectMethod' ? 2 : 3)];
    if (owner?.type === 'VariableDeclarator' && owner.id.type === 'Identifier' && owner.id.name === 'actions' && /\+page\.server\./.test(file)) {
      const key = fn.type === 'ObjectMethod' ? keyName(fn) : keyName(parent as Node);
      return { file, line, kind: 'form-action', name: `actions.${key ?? '?'}`, method: 'POST', ...svelteRoute(file) };
    }
  }
  // Tools a model can call.
  if (parent?.type === 'ObjectProperty' || fn.type === 'ObjectMethod') {
    const key = fn.type === 'ObjectMethod' ? keyName(fn) : keyName(parent as Node);
    const call = parents[parents.length - (fn.type === 'ObjectMethod' ? 2 : 3)];
    if (key === 'execute' && call?.type === 'CallExpression') {
      const callee = imports.canonical(call.callee as Node) ?? '';
      if (/(^|[.#])(tool|dynamicTool|createTool)$/.test(callee)) return { file, line, kind: 'model-tool', name: toolName(parents) ?? 'tool' };
    }
  }
  if (parent?.type === 'CallExpression') {
    const callee = imports.canonical(parent.callee as Node) ?? '';
    if (/(^|\.)(tool|registerTool)$/.test(callee) && /^(server|mcp|mcpServer)\./.test(callee)) {
      return { file, line, kind: 'mcp-tool', name: stringValue(parent.arguments[0] as Node) ?? 'tool' };
    }
    if (/(^|\.)(mutation|query)$/.test(callee) && /[Pp]rocedure/.test(callee)) {
      return { file, line, kind: 'trpc', name: trpcName(parents) ?? (callee.endsWith('mutation') ? 'mutation' : 'query'), ...(callee.endsWith('mutation') ? { method: 'POST' } : {}) };
    }
  }
  return null;
}

interface Summary {
  auth: string[];
  data: string[];
  writes: boolean;
  models: string[];
}

const EMPTY: Summary = { auth: [], data: [], writes: false, models: [] };

/**
 * What a function body does directly: auth calls, data access, model calls.
 * Used for entry points and, one level deep, for the local helpers they call
 * (so `await saveChat(...)` from lib/db/queries shows its database write).
 */
function scanBody(body: Node, imports: ImportMap, config: UbonConfig, extra?: (callee: string, name: string) => Summary | null) {
  const auth = new Set<string>();
  const data = new Set<string>();
  const network = new Set<string>();
  const models = new Set<string>();
  const env = new Set<string>();
  let writes = false;
  let rateLimit = false;
  const custom = new Set(config.auth.functions);
  walk(body, {
    enter(node, parents) {
      if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        const parent = parents[parents.length - 1];
        const grand = parents[parents.length - 2];
        // In a chain like db.select().from(t).where(x), only the outermost call is recorded.
        const innerLink = parent?.type === 'MemberExpression' && (parent as { object: Node }).object === node && grand?.type === 'CallExpression' && (grand as CallExpression).callee === parent;
        const callee = imports.canonical((node as CallExpression).callee as Node) ?? '';
        const bare = callee.replace(/^.*[#]/, '');
        const last = bare.split('.').pop() ?? '';
        if (AUTH_CALL.test(callee) || custom.has(bare) || custom.has(last)) auth.add(`${shortName(callee)}()`);
        if (MODEL_CALL.test(callee)) models.add(shortName(callee));
        if (/^(fetch|axios|got|ky)(\.|$)|^undici#/.test(callee)) {
          const target = (node as CallExpression).arguments[0];
          const literal = stringValue(target as Node);
          network.add(literal ? safeText(literal, 80) : `${shortName(callee)}(...)`);
        }
        if (RATE_LIMIT.test(callee)) rateLimit = true;
        const path = memberPath((node as CallExpression).callee as Node) ?? '';
        if (!innerLink && (DATA_ROOT.test(path) || /^supabase\.from\(\)/.test(path))) {
          data.add(dataLabel(path));
          if (WRITE_METHOD.test(path.replace(/\(\)/g, '')) || /\.(insert|update|upsert|delete)\(\)/.test(path)) writes = true;
        }
        if (extra && (node as CallExpression).callee.type === 'Identifier') {
          const name = ((node as CallExpression).callee as { name: string }).name;
          const summary = extra(callee, name);
          if (summary) {
            for (const a of summary.auth) auth.add(`${name}() (calls ${a})`);
            if (summary.data.length > 0) data.add(`${name}() [${summary.data.slice(0, 4).join(', ')}]`);
            if (summary.writes) writes = true;
            for (const m of summary.models) models.add(`${m} (in ${name})`);
          }
        }
      }
      if (node.type === 'TaggedTemplateExpression') {
        const tag = memberPath((node as TaggedTemplateExpression).tag as Node) ?? '';
        if (/^(sql|db\.sql)$/.test(tag)) {
          data.add('sql`...`');
          const q = (node as TaggedTemplateExpression).quasi.quasis.map((x) => x.value.raw).join(' ');
          if (/\b(insert|update|delete|upsert|merge)\b/i.test(q)) writes = true;
        }
      }
      if (node.type === 'MemberExpression') {
        const path = memberPath(node);
        const m = path ? /^(process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path) : null;
        if (m) env.add(m[2] as string);
      }
      if (node.type === 'NewExpression') {
        const callee = imports.canonical(node.callee as Node) ?? '';
        if (RATE_LIMIT.test(callee)) rateLimit = true;
      }
      return undefined;
    },
  });
  return { auth, data, network, models, env, writes, rateLimit };
}

/** Summaries of exported functions in local modules, computed on demand and cached. */
class HelperIndex {
  private readonly project: Project;
  private readonly config: UbonConfig;
  private readonly cache = new Map<string, Map<string, Summary>>();
  private readonly importsByFile = new Map<string, ImportMap>();

  constructor(project: Project, config: UbonConfig) {
    this.project = project;
    this.config = config;
  }

  bind(file: string, imports: ImportMap): void {
    this.importsByFile.set(file, imports);
  }

  /** Summary for a call to a local identifier imported from another module in the repository. */
  lookup(fromFile: string, name: string): Summary | null {
    const imports = this.importsByFile.get(fromFile);
    const binding = imports?.bindings.get(name);
    if (!binding) return null;
    const target = this.project.resolveImport(fromFile, binding.module);
    if (!target) return null;
    const exports = this.exportsOf(target);
    return exports.get(binding.imported === 'default' ? 'default' : binding.imported) ?? null;
  }

  private exportsOf(file: string): Map<string, Summary> {
    const cached = this.cache.get(file);
    if (cached) return cached;
    const out = new Map<string, Summary>();
    this.cache.set(file, out);
    const text = this.project.read(file);
    if (!text) return out;
    const parsed = parseSource(text, languageOf(file));
    for (const block of parsed.blocks) {
      const imports = new ImportMap(block.program);
      for (const stmt of block.program.program.body) {
        const decl = stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' ? stmt.declaration : null;
        if (!decl) continue;
        const fns: Array<[string, Node]> = [];
        if (decl.type === 'FunctionDeclaration') fns.push([stmt.type === 'ExportDefaultDeclaration' ? 'default' : decl.id?.name ?? 'default', decl.body]);
        else if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            const init = unwrap(d.init);
            if (d.id.type === 'Identifier' && init && isFunctionNode(init)) fns.push([d.id.name, (init as FunctionNode).body]);
          }
        }
        for (const [name, body] of fns) {
          const r = scanBody(body, imports, this.config);
          out.set(name, { auth: [...r.auth], data: [...r.data], writes: r.writes, models: [...r.models] });
        }
      }
    }
    return out;
  }
}

function describe(draft: EntryDraft, fn: FunctionNode, imports: ImportMap, config: UbonConfig, helpers: HelperIndex): EntryPoint {
  const r = scanBody(fn.body as Node, imports, config, (_callee, name) => helpers.lookup(draft.file, name) ?? EMPTY);
  const writes = r.writes || (draft.method !== undefined && MUTATING.has(draft.method));
  const declaredPublic = config.auth.public.length > 0 && matchesAny(draft.file, config.auth.public);
  return {
    ...draft,
    auth: [...r.auth].sort(),
    declaredPublic,
    data: [...r.data].sort().slice(0, 12),
    writes,
    network: [...r.network].sort().slice(0, 8),
    models: [...r.models].sort(),
    env: [...r.env].sort(),
    rateLimit: r.rateLimit,
  };
}

/** db.select().from(t).where(x) -> db.select; prisma.user.findMany -> prisma.user.findMany; supabase.from().insert -> supabase.from.insert */
function dataLabel(path: string): string {
  const parts = path.replace(/\(\)/g, '').split('.');
  const root = parts[0] ?? '';
  if (root === 'prisma') return parts.slice(0, 3).join('.');
  if (root === 'supabase') return parts.length > 2 ? `supabase.from.${parts[parts.length - 1]}` : parts.join('.');
  const writeIndex = parts.findIndex((p, i) => i > 0 && /^(insert|insertInto|update|updateTable|upsert|delete|deleteFrom|set|execute)$/.test(p));
  if (writeIndex > 0) return `${root}.${parts[writeIndex]}`;
  return parts.slice(0, 2).join('.');
}

function shortName(callee: string): string {
  const [mod, rest] = callee.includes('#') ? (callee.split('#') as [string, string]) : ['', callee];
  if (!mod) return rest;
  return rest === 'default' || rest === '*' ? mod : rest;
}

function functionName(fn: FunctionNode, parent: Node | undefined): string | null {
  if ((fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') && fn.id) return fn.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((fn.type === 'ObjectMethod' || fn.type === 'ClassMethod') && fn.key.type === 'Identifier') return fn.key.name;
  return null;
}

function isExported(parents: readonly Node[]): boolean {
  const parent = parents[parents.length - 1];
  if (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration') return true;
  if (parent?.type === 'VariableDeclarator') return parents[parents.length - 3]?.type === 'ExportNamedDeclaration';
  return false;
}

function toolName(parents: readonly Node[]): string | null {
  // tools: { weather: tool({ ... }) } or const weather = tool({ ... })
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type === 'ObjectProperty' && unwrap((p as { value: Node }).value)?.type === 'CallExpression') return keyName(p);
    if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  }
  return null;
}

function trpcName(parents: readonly Node[]): string | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type === 'ObjectProperty') return keyName(p);
  }
  return null;
}

/** app/(chat)/api/chat/[id]/route.ts -> /api/chat/[id] */
export function nextRoute(file: string): string | undefined {
  const m = /(?:^|\/)(?:src\/)?app\/(.*?)\/?route\.[cm]?[jt]sx?$/.exec(file);
  if (!m) return undefined;
  const segments = (m[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segments.join('/')}`;
}

function pagesRoute(file: string): string | undefined {
  const m = /(?:^|\/)(?:src\/)?pages\/(api\/.*)\.[cm]?[jt]sx?$/.exec(file);
  if (!m) return undefined;
  return `/${(m[1] ?? '').replace(/\/index$/, '')}`;
}

function svelteRoute(file: string): { route?: string } {
  const m = /(?:^|\/)src\/routes\/(.*?)\/?\+(?:server|page\.server)\.[cm]?[jt]s$/.exec(file);
  if (!m) return {};
  const segments = (m[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s));
  return { route: `/${segments.join('/')}` };
}

export function formatMapText(map: MapResult): string {
  const out: string[] = [];
  out.push(`ubon map: ${map.entryPoints.length} entry points in ${map.files} source files`);
  out.push('');
  for (const e of map.entryPoints) {
    const title = [e.method, e.route ?? e.name].filter(Boolean).join(' ');
    out.push(`${title}  ${e.file}:${e.line}  (${e.kind.replace('-', ' ')})`);
    out.push(`  auth: ${e.auth.length > 0 ? e.auth.join(', ') : e.declaredPublic ? 'none (declared public in ubon.json)' : 'none found'}`);
    if (e.data.length > 0) out.push(`  data: ${e.data.join(', ')}${e.writes ? ' (writes)' : ''}`);
    else if (e.writes) out.push('  data: none found directly (handles a mutating method)');
    if (e.models.length > 0) out.push(`  model calls: ${e.models.join(', ')}${e.rateLimit ? '' : ' (no rate limit call found)'}`);
    if (e.network.length > 0) out.push(`  network: ${e.network.join(', ')}`);
    if (e.env.length > 0) out.push(`  env: ${e.env.join(', ')}`);
  }
  const unauth = map.entryPoints.filter((e) => e.auth.length === 0 && !e.declaredPublic && (e.writes || e.models.length > 0));
  if (unauth.length > 0) {
    out.push('');
    out.push('Entry points that write data or call a model without an auth call found in the handler (review these first; the check may happen in middleware or a helper):');
    for (const e of unauth) out.push(`  ${e.file}:${e.line} ${[e.method, e.route ?? e.name].filter(Boolean).join(' ')}`);
  }
  const clientSecrets = map.envVars.filter((v) => v.secret && v.inClientCode && !publicPrefixOf(v.name));
  if (clientSecrets.length > 0) {
    out.push('');
    out.push('Secret-named env variables read in browser code:');
    for (const v of clientSecrets) out.push(`  ${v.name}: ${v.files.join(', ')}`);
  }
  if (map.notChecked.length > 0) {
    out.push('');
    out.push(`Not checked: ${map.notChecked.join('; ')}.`);
  }
  return `${out.join('\n')}\n`;
}

export function formatMapMarkdown(map: MapResult): string {
  const out: string[] = [`### Ubon map: ${map.entryPoints.length} entry points`, '', '| Entry point | Location | Auth | Data | Model calls |', '| --- | --- | --- | --- | --- |'];
  const cell = (t: string) => t.replace(/\|/g, '\\|');
  for (const e of map.entryPoints) {
    const title = [e.method, e.route ?? e.name].filter(Boolean).join(' ');
    out.push(
      `| ${cell(title)} | \`${cell(`${e.file}:${e.line}`)}\` | ${cell(e.auth.join(', ') || (e.declaredPublic ? 'public (declared)' : 'none found'))} | ${cell(e.data.join(', '))}${e.writes ? ' (writes)' : ''} | ${cell(e.models.join(', '))} |`,
    );
  }
  return `${out.join('\n')}\n`;
}

export { propertyName };
