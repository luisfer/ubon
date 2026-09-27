import { type SqlToken, expressionText, formatName } from '../../lang/sql.ts';
import type { Rule } from '../types.ts';
import { type PolicyState, dirStanding, findSupabaseDirs, historyFor, touchesSupabaseSql } from './supabase-sql.ts';

/**
 * Row level security policies that do not restrict rows: `using (true)` or
 * `with check (true)` for anon, authenticated, or public. On storage.objects
 * a bucket filter alone (`bucket_id = 'avatars'`) scopes the policy to a
 * bucket but still lets every user write every file in it. Checks such as
 * `auth.role() = 'authenticated'` or `auth.uid() is not null` only say "any
 * signed-in user", which is the same as `to authenticated using (true)`.
 */

type Reason = 'true' | 'bucket' | 'role';

interface Openness {
  open: boolean;
  reasons: Set<Reason>;
  buckets: string[];
}

const CLOSED: Openness = { open: false, reasons: new Set(), buckets: [] };

function isOp(t: SqlToken | undefined, value: string): boolean {
  return t !== undefined && t.type === 'op' && t.value === value;
}

/** Split at a top-level AND or OR (outside parentheses and brackets). */
function splitAt(tokens: readonly SqlToken[], word: 'and' | 'or'): SqlToken[][] {
  const out: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  let between = false;
  for (const t of tokens) {
    if (t.type === 'op' && (t.value === '(' || t.value === '[')) depth++;
    else if (t.type === 'op' && (t.value === ')' || t.value === ']')) depth--;
    if (depth === 0 && t.type === 'word') {
      if (t.value === 'between') between = true;
      else if (t.value === word && !(word === 'and' && between)) {
        out.push(current);
        current = [];
        continue;
      } else if (t.value === 'and' && between) between = false;
    }
    current.push(t);
  }
  out.push(current);
  return out;
}

/** The tokens inside one pair of parentheses that wraps the whole expression, or null. */
function unwrapParens(tokens: readonly SqlToken[]): SqlToken[] | null {
  if (!isOp(tokens[0], '(') || !isOp(tokens[tokens.length - 1], ')')) return null;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as SqlToken;
    if (t.type !== 'op') continue;
    if (t.value === '(' || t.value === '[') depth++;
    else if (t.value === ')' || t.value === ']') {
      depth--;
      if (depth === 0 && i !== tokens.length - 1) return null;
    }
  }
  return tokens.slice(1, -1);
}

const BUCKET_COLUMN = String.raw`\(?(?:(?:storage\.)?objects\.)?bucket_id\)?`;
const BUCKET_EQ = new RegExp(`^${BUCKET_COLUMN} = '([^']*)'$`);
const BUCKET_EQ_REVERSED = new RegExp(`^'([^']*)' = ${BUCKET_COLUMN}$`);
const BUCKET_IN = new RegExp(`^${BUCKET_COLUMN} in \\(((?:'[^']*'(?:, )?)+)\\)$`);
const BUCKET_ANY = new RegExp(`^${BUCKET_COLUMN} = any \\(array\\[((?:'[^']*'(?:, )?)+)\\]\\)$`);
const ROLE_ONLY = [
  /^\(?(?:select )?auth\.role\(\)\)? = '(?:authenticated|anon)'$/,
  /^'(?:authenticated|anon)' = \(?(?:select )?auth\.role\(\)\)?$/,
  /^\(?(?:select )?auth\.uid\(\)\)? is not null$/,
  /^\(?(?:select )?auth\.jwt\(\)\)? ->> 'role' = '(?:authenticated|anon)'$/,
  /^\(\(?(?:select )?auth\.jwt\(\)\)? ->> 'role'\) = '(?:authenticated|anon)'$/,
  /^\(?(?:select )?auth\.role\(\)\)? in \('(?:authenticated|anon)'(?:, '(?:authenticated|anon)')?\)$/,
];

function atom(tokens: readonly SqlToken[], storage: boolean): Openness {
  const text = expressionText(tokens);
  if (text === 'true' || text === '1 = 1' || text === "'true'" || text === 'true = true') return { open: true, reasons: new Set(['true']), buckets: [] };
  if (storage) {
    const eq = BUCKET_EQ.exec(text) ?? BUCKET_EQ_REVERSED.exec(text);
    if (eq) return { open: true, reasons: new Set(['bucket']), buckets: [eq[1] as string] };
    const list = BUCKET_IN.exec(text) ?? BUCKET_ANY.exec(text);
    if (list) return { open: true, reasons: new Set(['bucket']), buckets: [...(list[1] as string).matchAll(/'([^']*)'/g)].map((m) => m[1] as string) };
  }
  if (ROLE_ONLY.some((re) => re.test(text))) return { open: true, reasons: new Set(['role']), buckets: [] };
  return CLOSED;
}

/** Whether an expression lets every row through (for the roles the policy names). */
export function openness(tokens: readonly SqlToken[], storage: boolean, depth = 0): Openness {
  if (tokens.length === 0 || depth > 20) return CLOSED;
  const ors = splitAt(tokens, 'or');
  if (ors.length > 1) {
    const parts = ors.map((p) => openness(p, storage, depth + 1)).filter((p) => p.open);
    if (parts.length === 0) return CLOSED;
    return { open: true, reasons: new Set(parts.flatMap((p) => [...p.reasons])), buckets: parts.flatMap((p) => p.buckets) };
  }
  const ands = splitAt(tokens, 'and');
  if (ands.length > 1) {
    const parts = ands.map((p) => openness(p, storage, depth + 1));
    if (!parts.every((p) => p.open)) return CLOSED;
    return { open: true, reasons: new Set(parts.flatMap((p) => [...p.reasons])), buckets: parts.flatMap((p) => p.buckets) };
  }
  const inner = unwrapParens(tokens);
  if (inner) return openness(inner, storage, depth + 1);
  if (tokens[0]?.type === 'word' && tokens[0].value === 'not') return CLOSED;
  return atom(tokens, storage);
}

const API_ROLES = new Set(['public', 'anon', 'authenticated']);

function describeRoles(roles: string[]): string {
  const names = roles.join(', ');
  if (roles.includes('public')) return `anyone (${names})`;
  if (roles.includes('anon') && roles.includes('authenticated')) return `anonymous and signed-in users (${names})`;
  if (roles.includes('anon')) return `anonymous users (${names})`;
  return `any signed-in user (${names})`;
}

interface Verdict {
  level: 'block' | 'warn';
  clause: 'using' | 'with check';
  tokens: SqlToken[];
  result: Openness;
  /** What the roles can do, as a verb phrase. */
  action: string;
}

const STORAGE_TABLES = new Set(['objects', 'buckets']);

function assess(p: PolicyState, storageObjects: boolean): Verdict | null {
  if (!p.permissive) return null;
  const roles = (p.roles ?? ['public']).map((r) => r.toLowerCase());
  const who = roles.filter((r) => API_ROLES.has(r));
  if (who.length === 0) return null;
  const check = (tokens: SqlToken[] | null): Openness | null => {
    if (!tokens) return null;
    const result = openness(tokens, storageObjects);
    if (!result.open) return null;
    // "any signed-in user" checks are false for anon.
    if (result.reasons.size === 1 && result.reasons.has('role') && who.every((r) => r === 'anon')) return null;
    return result;
  };
  const using = check(p.using);
  const withCheck = check(p.withCheck);
  const rows = storageObjects ? 'file' : 'row';
  switch (p.command) {
    case 'select':
      return using ? { level: 'warn', clause: 'using', tokens: p.using as SqlToken[], result: using, action: `read every ${rows}` } : null;
    case 'insert':
      return withCheck
        ? { level: 'block', clause: 'with check', tokens: p.withCheck as SqlToken[], result: withCheck, action: storageObjects ? 'upload any file' : 'insert any row' }
        : null;
    case 'delete':
      return using ? { level: 'block', clause: 'using', tokens: p.using as SqlToken[], result: using, action: `delete every ${rows}` } : null;
    case 'update':
      if (using) return { level: 'block', clause: 'using', tokens: p.using as SqlToken[], result: using, action: storageObjects ? 'overwrite every file' : 'update every row' };
      // Storage updates go through the Storage API, which sets the owner itself.
      if (withCheck && p.using && !storageObjects) {
        return {
          level: 'warn',
          clause: 'with check',
          tokens: p.withCheck as SqlToken[],
          result: withCheck,
          action: `rewrite the ${rows}s they can update with any values, including the owner column`,
        };
      }
      return null;
    case 'all':
      if (using) {
        return {
          level: 'block',
          clause: 'using',
          tokens: p.using as SqlToken[],
          result: using,
          action: storageObjects ? 'read, upload, overwrite, and delete every file' : 'read, insert, update, and delete every row',
        };
      }
      if (withCheck) {
        return {
          level: 'block',
          clause: 'with check',
          tokens: p.withCheck as SqlToken[],
          result: withCheck,
          action: storageObjects ? 'upload files with any owner' : 'insert rows with any values, including another user\'s id',
        };
      }
      return null;
    default:
      return null;
  }
}

export const permissivePolicy: Rule = {
  meta: {
    id: 'data/permissive-policy',
    level: 'block',
    scope: 'project',
    title: 'Supabase policy that allows every row',
    summary:
      'A `create policy` for insert, update, delete, or all whose `using` or `with check` expression is `true` (or, on storage.objects, only a bucket filter) for anon, authenticated, or public. A select policy with `using (true)` is a warning.',
    why: 'A policy whose check is `true` turns row level security off for the roles it names. Sign-up is open on most Supabase projects, so "authenticated" means anyone who creates an account, and "anon" or "public" means anyone with the anon key.',
    fix: 'Replace `true` with a check on the row owner, such as `(select auth.uid()) = user_id`, or limit the policy to service_role.',
    cwe: ['CWE-284', 'CWE-862'],
    owasp: ['A01:2025'],
    levels:
      'block for insert, update, delete, and all policies; warn for select policies (often meant for public content), for update policies whose using clause restricts rows but whose with check is true, and for everything under example and template folders. Restrictive policies and policies only for service_role or other roles are ignored.',
  },
  project(ctx) {
    if (!touchesSupabaseSql(ctx)) return;
    for (const dir of findSupabaseDirs(ctx.project)) {
      const standing = dirStanding(dir);
      if (standing === 'skip') continue;
      const history = historyFor(ctx, dir);
      for (const p of history.policies) {
        const storage = p.schema === 'storage' && STORAGE_TABLES.has(p.table);
        if (!storage && !history.exposed.has(p.schema)) continue;
        const verdict = assess(p, storage && p.table === 'objects');
        if (!verdict) continue;
        if (ctx.info(p.at.file).generated) continue;
        const table = formatName({ schema: p.schema, name: p.table });
        const roles = (p.roles ?? ['public']).map((r) => r.toLowerCase()).filter((r) => API_ROLES.has(r));
        const expr = expressionText(verdict.tokens);
        const buckets = [...new Set(verdict.result.buckets)];
        const inBucket = buckets.length > 0 ? ` in bucket ${buckets.join(', ')}` : '';
        const reasons = verdict.result.reasons;
        // auth.role() = 'authenticated' and friends narrow "public" to any signed-in user.
        const signedInOnly = reasons.has('role') && !reasons.has('true') && !(roles.includes('anon') && !roles.includes('public'));
        const who = signedInOnly ? 'any signed-in user' : describeRoles(roles);
        const onlyBucket = reasons.has('bucket') && !reasons.has('true');
        const how = onlyBucket || signedInOnly ? `; the only check is ${verdict.clause} (${expr})` : `: ${verdict.clause} (${expr})`;
        const read = verdict.level === 'warn' && p.command === 'select';
        const rewrite = verdict.level === 'warn' && p.command === 'update';
        let message: string;
        let fix: string;
        if (read) {
          message = `Policy "${p.name}" on ${table} lets ${who} ${verdict.action}${inBucket} (${verdict.clause} (${expr})); make sure ${signedInOnly ? 'every signed-in user may see all of it' : 'it holds only public data'}.`;
          fix = `Keep ${verdict.clause} (${expr}) only if every ${storage ? 'file' : 'row'} is public; otherwise check the owner, such as (select auth.uid()) = user_id.`;
        } else if (rewrite) {
          const using = expressionText(p.using);
          message = `Policy "${p.name}" on ${table} checks the owner in using (${using}) but not in with check (${expr}), so users can rewrite their rows with any values, including the owner column.`;
          fix = `Repeat the owner check in with check: with check (${using}).`;
        } else {
          message = `Policy "${p.name}" on ${table} lets ${who} ${verdict.action}${inBucket}${how}.`;
          fix = storage
            ? 'Add an ownership check to the policy, such as (select auth.uid()) = owner_id or (storage.foldername(name))[1] = (select auth.uid())::text.'
            : `Replace ${verdict.clause} (${expr}) with a check on the row owner, such as (select auth.uid()) = user_id, or limit the policy to service_role.`;
        }
        ctx.report(p.at.file, {
          line: p.at.line,
          level: standing === 'example' ? 'warn' : verdict.level,
          message,
          fix,
          key: `${table}:${p.name}`,
        });
      }
    }
  },
};
