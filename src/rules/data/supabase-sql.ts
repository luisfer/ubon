import { pathContexts } from '../../core/context.ts';
import type { Project } from '../../core/project.ts';
import {
  type PolicyCommand,
  type QualifiedName,
  type SqlCommand,
  type SqlToken,
  formatName,
  isTrueOption,
  scanSqlFile,
} from '../../lang/sql.ts';
import type { ProjectContext } from '../types.ts';

/**
 * The state of a Supabase database after its SQL history: migrations in
 * supabase/migrations/*.sql (in file name order), then declarative schemas in
 * supabase/schemas/**.sql. Tracks which relations exist at the end, whether
 * each has row level security, which views run with the caller's rights, and
 * which policies are defined. Shared by data/rls-disabled and
 * data/permissive-policy.
 *
 * Choices that favor precision (fewer false findings):
 * - An `enable row level security` anywhere for a table counts, even when it
 *   appears before the create in file order (declarative schema files can be
 *   applied in an order set in config.toml). A drop followed by a new create
 *   starts over, as in Postgres.
 * - Static `enable row level security` inside a function body counts.
 *   Dynamic enables (EXECUTE format('... %I enable row level security'))
 *   inside a DO block enable every table that exists at that point; inside a
 *   function they may run on any table, so tables are not reported at all.
 * - A relation whose privileges were revoked from both anon and
 *   authenticated is not reachable through the Data API and is not reported.
 */

export interface Loc {
  file: string;
  line: number;
}

export interface SupabaseDir {
  /** Directory that holds supabase/ ('' for the repository root). */
  root: string;
  /** supabase/migrations/*.sql, in file name order. */
  migrations: string[];
  /** supabase/schemas/**.sql, in path order. */
  schemas: string[];
  config: string | null;
}

export interface RelationState {
  kind: 'table' | 'view' | 'materialized view';
  schema: string;
  name: string;
  partitionOf: string | null;
  /** Tables: every create statement (declarative schemas repeat the migrations). Views: the definition in force. */
  creates: Loc[];
  rls: 'unset' | 'enabled' | 'disabled';
  disabledAt: Loc | null;
  /** Views: created or altered with security_invoker = true. */
  invoker: boolean;
  /** Views: an ALTER VIEW that turned security_invoker off after the definition. */
  invokerLostAt: Loc | null;
  /** SET SCHEMA that moved the relation into an exposed schema. */
  movedAt: Loc | null;
  /** anon or authenticated, when their privileges on the relation were revoked. */
  revoked: Set<string>;
}

export interface PolicyState {
  name: string;
  schema: string;
  table: string;
  command: PolicyCommand;
  permissive: boolean;
  roles: string[] | null;
  using: SqlToken[] | null;
  withCheck: SqlToken[] | null;
  /** Where the policy got its current roles and expressions. */
  at: Loc;
}

export interface SqlHistory {
  dir: SupabaseDir;
  exposed: Set<string>;
  relations: RelationState[];
  policies: PolicyState[];
  /** A function enables row level security on tables it builds names for at run time. */
  dynamicRlsFunction: Loc | null;
}

const SQL_PATH = /^(?:(.*)\/)?supabase\/(migrations|schemas)\/(.+\.sql)$/;

export function findSupabaseDirs(project: Project): SupabaseDir[] {
  const map = new Map<string, SupabaseDir>();
  for (const file of project.files) {
    if (!file.endsWith('.sql')) continue;
    const m = SQL_PATH.exec(file);
    if (!m) continue;
    const root = m[1] ?? '';
    const kind = m[2] as string;
    const rest = m[3] as string;
    if (kind === 'migrations' && rest.includes('/')) continue;
    let dir = map.get(root);
    if (!dir) {
      dir = { root, migrations: [], schemas: [], config: null };
      map.set(root, dir);
    }
    (kind === 'migrations' ? dir.migrations : dir.schemas).push(file);
  }
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  for (const dir of map.values()) {
    dir.migrations.sort((a, b) => (base(a) < base(b) ? -1 : base(a) > base(b) ? 1 : 0));
    dir.schemas.sort();
    const config = `${dir.root ? `${dir.root}/` : ''}supabase/config.toml`;
    if (project.has(config)) dir.config = config;
  }
  return [...map.values()].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}

/** True when a changed file can affect what the data rules report. */
export function touchesSupabaseSql(ctx: ProjectContext): boolean {
  if (ctx.mode === 'all') return true;
  return ctx.scopeFiles.some((f) => f.status !== 'deleted' && (SQL_PATH.test(f.path) || /(^|\/)supabase\/config\.toml$/.test(f.path)));
}

/** Where a Supabase directory sits: skipped under test folders, warn-only under examples and templates. */
export function dirStanding(dir: SupabaseDir): 'skip' | 'example' | 'normal' {
  const ctx = pathContexts(`${dir.root ? `${dir.root}/` : ''}supabase/migrations/x.sql`);
  if (ctx.has('test')) return 'skip';
  if (ctx.has('example')) return 'example';
  return 'normal';
}

/**
 * Schemas exposed through the Data API: public, plus `schemas` under [api]
 * in supabase/config.toml. A small reader, not a TOML parser.
 */
export function exposedSchemas(configText: string | null): Set<string> {
  const out = new Set(['public']);
  if (!configText) return out;
  let section = '';
  let collecting = false;
  let buffer = '';
  for (const raw of configText.split('\n')) {
    const line = stripTomlComment(raw);
    if (!collecting) {
      const header = /^\s*\[\s*([^\]]+?)\s*\]\s*$/.exec(line);
      if (header) {
        section = header[1] as string;
        continue;
      }
      const m = section === 'api' ? /^\s*schemas\s*=\s*(\[.*)$/.exec(line) : section === '' ? /^\s*api\.schemas\s*=\s*(\[.*)$/.exec(line) : null;
      if (!m) continue;
      buffer = m[1] as string;
      collecting = true;
    } else buffer += ` ${line}`;
    if (collecting && buffer.includes(']')) {
      for (const s of buffer.slice(0, buffer.indexOf(']')).matchAll(/"([^"]*)"|'([^']*)'/g)) {
        const name = (s[1] ?? s[2] ?? '').trim();
        if (name) out.add(name);
      }
      collecting = false;
      buffer = '';
    }
  }
  return out;
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

const cache = new WeakMap<Project, Map<string, SqlHistory>>();

export function historyFor(ctx: ProjectContext, dir: SupabaseDir): SqlHistory {
  let byRoot = cache.get(ctx.project);
  if (!byRoot) {
    byRoot = new Map();
    cache.set(ctx.project, byRoot);
  }
  const cached = byRoot.get(dir.root);
  if (cached) return cached;
  const history = buildHistory((p) => ctx.read(p), dir);
  byRoot.set(dir.root, history);
  return history;
}

const API_ROLES = ['anon', 'authenticated'];

function closesTable(privileges: readonly string[]): boolean {
  return privileges.includes('all') || ['select', 'insert', 'update', 'delete'].every((p) => privileges.includes(p));
}

function closesView(privileges: readonly string[]): boolean {
  return privileges.includes('all') || privileges.includes('select');
}

export function buildHistory(read: (path: string) => string | null, dir: SupabaseDir): SqlHistory {
  const exposed = exposedSchemas(dir.config ? read(dir.config) : null);
  const live = new Map<string, RelationState>();
  const pendingEnable = new Set<string>();
  const policies = new Map<string, PolicyState>();
  const defaultRevoked = new Map<string, Set<string>>();
  let dynamicRlsFunction: Loc | null = null;
  const key = (schema: string, name: string) => `${schema}\u0000${name}`;
  const policyKey = (schema: string, table: string, name: string) => `${schema}\u0000${table}\u0000${name}`;

  const moveRelation = (rel: RelationState, schema: string, name: string) => {
    const oldKey = key(rel.schema, rel.name);
    live.delete(oldKey);
    for (const [k, p] of [...policies]) {
      if (p.schema !== rel.schema || p.table !== rel.name) continue;
      policies.delete(k);
      p.schema = schema;
      p.table = name;
      policies.set(policyKey(schema, name, p.name), p);
    }
    rel.schema = schema;
    rel.name = name;
    live.set(key(schema, name), rel);
  };
  const dropRelation = (schema: string, name: string) => {
    live.delete(key(schema, name));
    for (const [k, p] of [...policies]) if (p.schema === schema && p.table === name) policies.delete(k);
  };

  for (const file of [...dir.migrations, ...dir.schemas]) {
    const text = read(file);
    if (!text) continue;
    const scan = scanSqlFile(text);
    let searchSchema = 'public';
    const resolve = (n: QualifiedName) => ({ schema: n.schema ?? searchSchema, name: n.name });
    type Event = { start: number; line: number; run: () => void };
    const events: Event[] = [];
    for (const at of scan.commands) {
      const loc: Loc = { file, line: at.line };
      const cmd: SqlCommand = at.command;
      const inFunction = at.context === 'function';
      events.push({
        start: at.start,
        line: at.line,
        run: () => {
          switch (cmd.kind) {
            case 'set-search-path': {
              if (at.context !== 'top') break;
              const first = cmd.schemas.find((s) => s !== '$user' && s !== 'pg_catalog' && s !== '');
              searchSchema = first ?? 'public';
              break;
            }
            case 'create-table': {
              if (inFunction || cmd.temporary || cmd.foreign) break;
              const r = resolve(cmd.name);
              const k = key(r.schema, r.name);
              const existing = live.get(k);
              if (existing && existing.kind === 'table') {
                existing.creates.push(loc);
                break;
              }
              if (existing) dropRelation(r.schema, r.name);
              const revoked = new Set<string>([...(defaultRevoked.get(r.schema) ?? []), ...(defaultRevoked.get('*') ?? [])]);
              live.set(k, {
                kind: 'table',
                schema: r.schema,
                name: r.name,
                partitionOf: cmd.partitionOf ? formatName(resolve(cmd.partitionOf)) : null,
                creates: [loc],
                rls: pendingEnable.has(k) ? 'enabled' : 'unset',
                disabledAt: null,
                invoker: false,
                invokerLostAt: null,
                movedAt: null,
                revoked,
              });
              break;
            }
            case 'create-view': {
              if (inFunction || cmd.temporary) break;
              const r = resolve(cmd.name);
              const k = key(r.schema, r.name);
              const kind = cmd.materialized ? 'materialized view' : 'view';
              // CREATE OR REPLACE VIEW replaces the view's options too, so the new definition decides.
              const invoker = !cmd.materialized && isTrueOption(cmd.options.security_invoker);
              const existing = live.get(k);
              if (existing && existing.kind !== 'table') {
                existing.kind = kind;
                existing.creates = [loc];
                existing.invoker = invoker;
                existing.invokerLostAt = null;
                break;
              }
              const revoked = new Set<string>([...(defaultRevoked.get(r.schema) ?? []), ...(defaultRevoked.get('*') ?? [])]);
              live.set(k, {
                kind,
                schema: r.schema,
                name: r.name,
                partitionOf: null,
                creates: [loc],
                rls: 'unset',
                disabledAt: null,
                invoker,
                invokerLostAt: null,
                movedAt: null,
                revoked,
              });
              break;
            }
            case 'alter-relation': {
              const r = resolve(cmd.name);
              let rel = live.get(key(r.schema, r.name));
              for (const action of cmd.actions) {
                if (action.type === 'enable-rls') {
                  if (rel) {
                    rel.rls = 'enabled';
                    rel.disabledAt = null;
                  } else pendingEnable.add(key(r.schema, r.name));
                  continue;
                }
                if (inFunction || !rel) continue;
                if (action.type === 'disable-rls') {
                  rel.rls = 'disabled';
                  rel.disabledAt = loc;
                } else if (action.type === 'rename') {
                  moveRelation(rel, rel.schema, action.to);
                } else if (action.type === 'set-schema') {
                  const wasExposed = exposed.has(rel.schema);
                  moveRelation(rel, action.schema, rel.name);
                  if (!wasExposed && exposed.has(action.schema)) rel.movedAt = loc;
                } else if (action.type === 'set-options' && 'security_invoker' in action.options) {
                  rel.invoker = isTrueOption(action.options.security_invoker);
                  rel.invokerLostAt = rel.invoker ? null : loc;
                } else if (action.type === 'reset-options' && action.names.includes('security_invoker')) {
                  rel.invoker = false;
                  rel.invokerLostAt = loc;
                }
                rel = live.get(key(rel.schema, rel.name));
              }
              break;
            }
            case 'drop-relation': {
              if (inFunction) break;
              for (const n of cmd.names) {
                const r = resolve(n);
                dropRelation(r.schema, r.name);
              }
              break;
            }
            case 'drop-schema': {
              if (inFunction) break;
              for (const rel of [...live.values()]) if (cmd.names.includes(rel.schema)) dropRelation(rel.schema, rel.name);
              break;
            }
            case 'rename-schema': {
              if (inFunction) break;
              for (const rel of [...live.values()]) if (rel.schema === cmd.from) moveRelation(rel, cmd.to, rel.name);
              break;
            }
            case 'grant':
            case 'revoke': {
              if (inFunction) break;
              const targets: RelationState[] = [];
              for (const n of cmd.tables) {
                const r = resolve(n);
                const rel = live.get(key(r.schema, r.name));
                if (rel) targets.push(rel);
              }
              if (cmd.schemas.length > 0) for (const rel of live.values()) if (cmd.schemas.includes(rel.schema)) targets.push(rel);
              const roles = cmd.roles.map((r) => r.toLowerCase());
              for (const rel of targets) {
                if (cmd.kind === 'revoke') {
                  const closes = rel.kind === 'table' ? closesTable(cmd.privileges) : closesView(cmd.privileges);
                  if (!closes) continue;
                  for (const role of roles) if (API_ROLES.includes(role)) rel.revoked.add(role);
                } else {
                  if (cmd.privileges.length === 0) continue;
                  if (roles.includes('public')) rel.revoked.clear();
                  for (const role of roles) rel.revoked.delete(role);
                }
              }
              break;
            }
            case 'default-privileges': {
              if (inFunction) break;
              const schemas = cmd.schemas.length > 0 ? cmd.schemas : ['*'];
              const roles = cmd.roles.map((r) => r.toLowerCase());
              for (const s of schemas) {
                const set = defaultRevoked.get(s) ?? new Set<string>();
                if (cmd.action === 'revoke' && closesTable(cmd.privileges)) {
                  for (const role of roles) if (API_ROLES.includes(role)) set.add(role);
                } else if (cmd.action === 'grant' && cmd.privileges.length > 0) {
                  if (roles.includes('public')) set.clear();
                  for (const role of roles) set.delete(role);
                }
                defaultRevoked.set(s, set);
              }
              break;
            }
            case 'create-policy': {
              if (inFunction) break;
              const t = resolve(cmd.table);
              policies.set(policyKey(t.schema, t.name, cmd.name), {
                name: cmd.name,
                schema: t.schema,
                table: t.name,
                command: cmd.command,
                permissive: cmd.permissive,
                roles: cmd.roles,
                using: cmd.using,
                withCheck: cmd.withCheck,
                at: loc,
              });
              break;
            }
            case 'alter-policy': {
              if (inFunction) break;
              const t = resolve(cmd.table);
              const k = policyKey(t.schema, t.name, cmd.name);
              const p = policies.get(k);
              if (!p) break;
              if (cmd.renameTo !== null) {
                policies.delete(k);
                p.name = cmd.renameTo;
                policies.set(policyKey(t.schema, t.name, p.name), p);
              }
              if (cmd.roles !== null) {
                p.roles = cmd.roles;
                p.at = loc;
              }
              if (cmd.using !== null) {
                p.using = cmd.using;
                p.at = loc;
              }
              if (cmd.withCheck !== null) {
                p.withCheck = cmd.withCheck;
                p.at = loc;
              }
              break;
            }
            case 'drop-policy': {
              if (inFunction) break;
              const t = resolve(cmd.table);
              policies.delete(policyKey(t.schema, t.name, cmd.name));
              break;
            }
            default:
              break;
          }
        },
      });
    }
    for (const d of scan.dynamicRls) {
      const loc: Loc = { file, line: d.line };
      events.push({
        start: d.start,
        line: d.line,
        run: () => {
          if (d.context === 'function') {
            dynamicRlsFunction ??= loc;
            return;
          }
          for (const rel of live.values()) {
            if (rel.kind !== 'table') continue;
            rel.rls = 'enabled';
            rel.disabledAt = null;
          }
        },
      });
    }
    events.sort((a, b) => a.start - b.start);
    for (const e of events) e.run();
  }

  return {
    dir,
    exposed,
    relations: [...live.values()],
    policies: [...policies.values()],
    dynamicRlsFunction,
  };
}
