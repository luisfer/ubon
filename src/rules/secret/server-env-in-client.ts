import type { MemberExpression } from '@babel/types';
import { hasDirective } from '../../core/project.ts';
import { memberPath } from '../../lang/js.ts';
import type { Rule } from '../types.ts';
import { isSecretName, publicPrefixOf } from './names.ts';

/**
 * A secret-named `process.env.X` (or `import.meta.env.X`) without a public
 * prefix read in code that ships to the browser. The value is undefined
 * there, and the usual follow-up mistake is renaming the variable with
 * NEXT_PUBLIC_, which publishes the secret. Other variables are left alone:
 * modules shared by server and client code often read server-only flags that
 * only the server uses.
 *
 * Client entry points are checked in full: files with 'use client', client
 * script blocks (Vue, Svelte, Astro), and single-page apps with no server.
 * Modules that a client file imports are often shared config objects whose
 * server-only fields are read on the server only, so in those only a direct
 * `export const X = process.env.SECRET` is reported. Reads inside createEnv()
 * (t3-env) are skipped: the library keeps server variables on the server.
 */

const SERVER_FRAMEWORKS = ['next', 'nuxt', 'sveltekit', 'remix', 'react-router', 'astro', 'tanstack-start'] as const;

const ALWAYS_AVAILABLE = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'TZ', '__NEXT_ROUTER_BASEPATH']);

function nextConfigEnvNames(ctxProject: { files: readonly string[]; read(p: string): string | null }): Set<string> {
  const out = new Set<string>();
  for (const f of ctxProject.files) {
    if (!/(^|\/)next\.config\.[cm]?[jt]s$/.test(f)) continue;
    const text = ctxProject.read(f) ?? '';
    const block = /\benv\s*:\s*\{([\s\S]*?)\}/.exec(text);
    if (!block) continue;
    for (const m of (block[1] ?? '').matchAll(/([A-Z_][A-Z0-9_]*)\s*:/g)) out.add(m[1] as string);
  }
  return out;
}

export const serverEnvInClient: Rule = {
  meta: {
    id: 'secret/server-env-in-client',
    level: 'warn',
    scope: 'project',
    title: 'Server env variable read in browser code',
    summary: 'A secret-named `process.env.X` or `import.meta.env.X` (API keys, tokens, passwords, database URLs) read in a module that ships to the browser.',
    why: 'Only prefixed variables are copied into the browser bundle, so the value is undefined there. Renaming the variable with a public prefix "fixes" it by publishing the value, which is wrong for secrets.',
    fix: 'Read the variable in server code (a route handler, Server Action, or loader) and pass only the result to the browser.',
    cwe: ['CWE-200'],
  },
  appliesTo: (file) => file.client && !file.server && !file.contexts.has('test') && !file.contexts.has('config'),
  js(ctx) {
    let extra: Set<string> | null = null;
    const frameworks = ctx.project.frameworksFor(ctx.file.path);
    const spa = !SERVER_FRAMEWORKS.some((f) => frameworks.has(f));
    const entry = ctx.side === 'client' || hasDirective(ctx.text, 'use client') || spa;
    /** `export const X = process.env.Y`, allowing `as string` and `!` around the read. */
    const isDirectExport = (): boolean => {
      const chain = [...ctx.parents].reverse();
      let i = 0;
      while (chain[i] && (chain[i]?.type === 'TSAsExpression' || chain[i]?.type === 'TSNonNullExpression' || chain[i]?.type === 'TSSatisfiesExpression')) i++;
      return chain[i]?.type === 'VariableDeclarator' && chain[i + 1]?.type === 'VariableDeclaration' && chain[i + 2]?.type === 'ExportNamedDeclaration';
    };
    return {
      MemberExpression(node: MemberExpression) {
        if (ctx.side === 'server') return;
        if (!entry && !isDirectExport()) return;
        if (ctx.parents.some((p) => p.type === 'CallExpression' && p.callee.type === 'Identifier' && p.callee.name === 'createEnv')) return;
        const path = memberPath(node);
        if (!path) return;
        const m = /^(process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path);
        if (!m) return;
        const name = m[2] as string;
        if (ALWAYS_AVAILABLE.has(name) || publicPrefixOf(name, ctx.project, ctx.file.path) || !isSecretName(name)) return;
        if (m[1] === 'process.env' && /^(VITE_|PUBLIC_)/.test(name)) return;
        extra ??= nextConfigEnvNames(ctx.project);
        if (extra.has(name)) return;
        ctx.report(node, {
          message: `${m[1]}.${name} is read in code that ships to the browser, where it is undefined. Do not fix it by adding a public prefix: that publishes the secret.`,
          key: name,
        });
      },
    };
  },
};
