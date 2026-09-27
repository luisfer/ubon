import type { CallExpression, NewExpression, Node, VariableDeclarator } from '@babel/types';
import { languageOf } from '../../core/files.ts';
import { hasDirective } from '../../core/project.ts';
import { commentStyleFor, maskComments } from '../../lang/comments.ts';
import { keyName, memberPath, objectProp, stringValue, unwrap } from '../../lang/js.ts';
import { isFunctionNode } from '../../lang/walk.ts';
import { findProviderKeys } from '../secret/provider-key.ts';
import type { Rule } from '../types.ts';

/**
 * A Supabase client created with the service role key (or a secret key) in a
 * module that ships to the browser. A public-prefixed env name for the key is
 * reported by secret/public-env-name; this rule reports the client creation.
 */

/** Supabase client factories, by canonical callee, and where each takes the key. */
const FACTORIES: Record<string, 'second' | 'options'> = {
  '@supabase/supabase-js#createClient': 'second',
  '@supabase/supabase-js#SupabaseClient': 'second',
  '@supabase/ssr#createBrowserClient': 'second',
  '@supabase/ssr#createServerClient': 'second',
  '@supabase/auth-helpers-nextjs#createClientComponentClient': 'options',
  '@supabase/auth-helpers-nextjs#createPagesBrowserClient': 'options',
  '@supabase/auth-helpers-nextjs#createBrowserSupabaseClient': 'options',
  '@supabase/auth-helpers-react#createClientComponentClient': 'options',
  '@supabase/auth-helpers-sveltekit#createSupabaseLoadClient': 'options',
  // The UMD build from a CDN defines a global `supabase`.
  'supabase.createClient': 'second',
  'window.supabase.createClient': 'second',
};

/** npm:, jsr:, and CDN specifiers name the same package: npm:@supabase/supabase-js@2, https://esm.sh/@supabase/supabase-js@2. */
function normalizeCallee(callee: string): string {
  const hash = callee.indexOf('#');
  if (hash === -1) return callee;
  let module = callee.slice(0, hash);
  const m = /(@supabase\/[\w.-]+?)(?:@[\w.^~-]+)?(?:\/\+esm|\/dist\/[\w./-]+)?$/.exec(module.replace(/^(npm|jsr):/, ''));
  if (m && /^(npm:|jsr:|https?:\/\/|@supabase\/)/.test(module)) module = m[1] as string;
  return `${module}${callee.slice(hash)}`;
}

/**
 * The name of the top-level function that contains a node, or null when the
 * node runs at module level (on import). React components and hooks count as
 * module-level: they run in the browser whenever they render.
 */
function enclosingExport(parents: readonly Node[]): string | null {
  if (!parents.some((p) => isFunctionNode(p))) return null;
  const top = parents[1];
  if (!top) return null;
  let name: string | null = null;
  const decl = top.type === 'ExportNamedDeclaration' || top.type === 'ExportDefaultDeclaration' ? (top.declaration as Node | null) : top;
  if (!decl) return null;
  if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) name = decl.id.name;
  else if (decl.type === 'VariableDeclaration') {
    const first = decl.declarations[0];
    if (first?.id.type === 'Identifier') name = first.id.name;
  }
  if (!name || /^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) return null;
  return name;
}

function upperSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]/g, '_')
    .toUpperCase();
}

/** Names that say the value is the service role key or a Supabase secret key. */
export function isServiceKeyName(name: string): boolean {
  const n = upperSnake(name);
  if (/(^|_)(ANON|PUBLISHABLE|PUBLIC_KEY)(_|$)/.test(n) && !/SERVICE_?ROLE/.test(n)) return false;
  if (/SERVICE_?ROLE/.test(n)) return true;
  if (/(SUPABASE|SB)_?(SERVICE|SECRET)(_KEY)?$/.test(n) || /(SUPABASE|SB)_?(SERVICE|SECRET)_(API_)?KEY/.test(n)) return true;
  if (/^(SERVICE_KEY|SERVICE_ROLE_KEY)$/.test(n)) return true;
  return false;
}

export const serviceRoleInClient: Rule = {
  meta: {
    id: 'data/service-role-in-client',
    level: 'block',
    scope: 'project',
    title: 'Supabase service role key in browser code',
    summary:
      'A Supabase client created with the service role or secret key (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY, an sb_secret_ key, or a JWT with role service_role) in a module that ships to the browser.',
    why: 'The service role key bypasses row level security and can read, change, and delete every row. Browser code is public: the key either ships in the bundle, or it is undefined there and the usual next step, renaming it with a public prefix, publishes it.',
    fix: 'Create the service role client only in server code (a route handler, Server Action, or server-only module) and use the anon or publishable key in the browser.',
    cwe: ['CWE-798', 'CWE-284'],
    owasp: ['A01:2025'],
    levels:
      'block when the client is created at module level, in a \'use client\' module, in a single-page app, or inside a function that browser code calls; warn when it is created inside a function of a shared module that browser code imports but does not call, and under example and template folders.',
  },
  appliesTo: (file) => file.client && !file.server && !file.generated && !file.contexts.has('test') && !file.contexts.has('config'),
  js(ctx) {
    if (ctx.side === 'server') return {};
    // Local names bound to a service role key: const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const bound = new Map<string, string>();
    const example = ctx.file.contexts.has('example');

    const describe = (node: Node | null | undefined, depth = 0): string | null => {
      const n = unwrap(node);
      if (!n || depth > 4) return null;
      if (n.type === 'LogicalExpression') return describe(n.left, depth + 1) ?? describe(n.right, depth + 1);
      if (n.type === 'ConditionalExpression') return describe(n.consequent, depth + 1) ?? describe(n.alternate, depth + 1);
      const literal = stringValue(n);
      if (literal !== null) {
        const key = findProviderKeys(literal).find((k) => k.format.id === 'supabase-secret' || k.format.id === 'supabase-service-jwt');
        if (!key) return null;
        return key.format.id === 'supabase-secret' ? 'a literal Supabase secret key' : 'a literal service role JWT';
      }
      if (n.type === 'Identifier') {
        const hit = bound.get(n.name);
        if (hit) return hit;
        return isServiceKeyName(n.name) ? n.name : null;
      }
      if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
        const path = memberPath(n);
        if (!path) return null;
        const last = path.slice(path.lastIndexOf('.') + 1);
        return isServiceKeyName(last) ? path : null;
      }
      if (n.type === 'CallExpression') {
        // Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), env('SUPABASE_SERVICE_ROLE_KEY')
        const arg = stringValue(n.arguments[0] as Node | undefined);
        const callee = memberPath(n.callee);
        if (arg && callee && /(^|\.)(get|env|getEnv|getEnvVar|required|requireEnv)$/i.test(callee) && isServiceKeyName(arg)) return `${callee}('${arg}')`;
        // Wrappers that validate and return the value: getEnvVar(process.env.SUPABASE_SERVICE_ROLE_KEY, '...')
        const first = n.arguments[0] as Node | undefined;
        if (first && first.type !== 'StringLiteral') return describe(first, depth + 1);
      }
      return null;
    };

    // Where the file's code runs: a 'use client' module or a single-page app runs all of it in the
    // browser; a shared module in the client graph runs in the browser only what browser code calls.
    const allBrowser = hasDirective(ctx.text, 'use client') || ctx.project.isSpa(ctx.file.path) || ctx.file.lang === 'vue' || ctx.file.lang === 'svelte';
    let clientImporters: Array<{ path: string; text: string; browserOnly: boolean }> | null = null;
    const importers = () => {
      // Usage examples in doc comments look like imports to the project graph, so the file can list itself.
      clientImporters ??= ctx.project
        .importersOf(ctx.file.path)
        .filter((p) => p !== ctx.file.path && ctx.project.isClient(p) && !ctx.project.isServer(p))
        .map((p) => {
          const raw = ctx.project.read(p) ?? '';
          const lang = languageOf(p);
          // Shared modules can branch on the environment (typeof window); these files run only in the browser.
          const browserOnly = hasDirective(raw, 'use client') || lang === 'vue' || lang === 'svelte' || ctx.project.isSpa(p);
          return { path: p, text: maskComments(raw, commentStyleFor(lang, p)), browserOnly };
        });
      return clientImporters;
    };

    const check = (node: CallExpression | NewExpression) => {
      const raw = ctx.imports.canonical(node.callee as Node);
      if (!raw) return;
      const callee = normalizeCallee(raw);
      const where = FACTORIES[callee];
      if (!where) return;
      let keyNode: Node | null | undefined;
      if (where === 'second') keyNode = node.arguments[1] as Node | undefined;
      else keyNode = objectProp(node.arguments[0] as Node | undefined, 'supabaseKey');
      const note = describe(keyNode);
      if (!note) return;
      const name = `${node.type === 'NewExpression' ? 'new ' : ''}${callee.slice(callee.lastIndexOf('#') + 1).replace(/^(window\.)?supabase\./, '')}()`;
      const holder = enclosingExport(ctx.parents);
      let level: 'block' | 'warn' = 'block';
      let message = `${name} in code that ships to the browser uses the service role key (${note}), which bypasses row level security.`;
      // A browser client built with the service role key is wrong wherever it is called.
      const browserFactory = /#(createBrowserClient|createClientComponentClient|createPagesBrowserClient|createBrowserSupabaseClient)$/.test(callee);
      if (holder && !allBrowser && !browserFactory) {
        // A factory function in a shared module: it runs in the browser only if browser code calls it.
        const pattern = new RegExp(`\\b${holder.replace(/[$]/g, '\\$')}\\b`);
        const caller = importers().find((i) => i.browserOnly && pattern.test(i.text));
        if (caller) {
          message = `${name} uses the service role key (${note}) inside ${holder}(), which ${caller.path} calls in code that ships to the browser; the key bypasses row level security.`;
        } else {
          level = 'warn';
          const via = importers()[0]?.path;
          message = `${name} uses the service role key (${note}) inside ${holder}(), in a module that ships to the browser${via ? ` because ${via} imports it` : ''}; no browser code calls it yet.`;
        }
      }
      ctx.report(node, {
        level: example ? 'warn' : level,
        message,
        fix:
          level === 'warn'
            ? `Move ${holder}() to a server-only module (add import 'server-only') so browser code cannot import it.`
            : 'Create the service role client only in server code (a route handler, Server Action, or server-only module) and use the anon or publishable key in the browser.',
        key: note,
      });
    };

    return {
      VariableDeclarator(node: VariableDeclarator) {
        if (node.id.type === 'Identifier') {
          const note = describe(node.init);
          if (note) bound.set(node.id.name, note);
          return;
        }
        // const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env
        if (node.id.type === 'ObjectPattern') {
          const source = memberPath(node.init);
          if (source !== 'process.env' && source !== 'import.meta.env') return;
          for (const prop of node.id.properties) {
            if (prop.type !== 'ObjectProperty' || prop.value.type !== 'Identifier') continue;
            const k = keyName(prop);
            if (k && isServiceKeyName(k)) bound.set(prop.value.name, `${source}.${k}`);
          }
        }
      },
      CallExpression: check,
      NewExpression: check,
    };
  },
};
