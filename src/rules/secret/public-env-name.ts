import { commentStyleFor, maskComments } from '../../lang/comments.ts';
import type { Rule } from '../types.ts';
import { isSecretName, publicPrefixOf, stripPublicPrefix } from './names.ts';

/**
 * Env var names that a framework ships to the browser but whose name says the
 * value is secret: NEXT_PUBLIC_OPENAI_API_KEY, VITE_SUPABASE_SERVICE_ROLE_KEY.
 */

const NAME = /\b(NEXT_PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_|REACT_APP_|GATSBY_|VITE_|PUBLIC_)([A-Z0-9_]+)\b/g;

export const publicEnvName: Rule = {
  meta: {
    id: 'secret/public-env-name',
    level: 'block',
    scope: 'file',
    title: 'Secret in a browser-exposed env variable',
    summary: 'An environment variable with a prefix the framework ships to the browser (NEXT_PUBLIC_, VITE_, PUBLIC_, EXPO_PUBLIC_, REACT_APP_, ...) whose name says it holds a secret.',
    why: 'Frameworks copy every variable with a public prefix into the JavaScript bundle, so its value is readable by anyone who opens the site. Renaming a server variable with NEXT_PUBLIC_ is a common agent "fix" when a value is undefined in the browser.',
    fix: 'Keep the secret in a server-only variable (no public prefix) and call it from a route handler, Server Action, or server function; rotate the key if the site was deployed with the public name.',
    cwe: ['CWE-200', 'CWE-798'],
    owasp: ['A04:2025'],
  },
  appliesTo: (file) => !file.generated && file.lang !== 'markdown' && !file.contexts.has('docs'),
  text(ctx) {
    if (!/(NEXT_PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_|REACT_APP_|GATSBY_|VITE_|PUBLIC_)[A-Z0-9_]/.test(ctx.text)) return;
    const seen = new Set<string>();
    // Names in comments are not uses (docs, commented-out code).
    const lines = maskComments(ctx.text, commentStyleFor(ctx.file.lang, ctx.file.path)).split('\n');
    lines.forEach((line, i) => {
      NAME.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NAME.exec(line))) {
        const full = `${m[1]}${m[2]}`;
        if (seen.has(full)) continue;
        // PUBLIC_ inside a longer prefix (NEXT_PUBLIC_) is matched by that prefix first.
        if (m[1] === 'PUBLIC_' && m.index > 0 && /[A-Z0-9_]/.test(line[m.index - 1] ?? '')) continue;
        const prefix = publicPrefixOf(full, ctx.project, ctx.file.path);
        if (!prefix || !isSecretName(full)) continue;
        seen.add(full);
        ctx.report({
          line: i + 1,
          column: m.index + 1,
          endColumn: m.index + full.length + 1,
          message: `${full} is shipped to the browser (${prefix.label} exposes every ${prefix.prefix} variable), but its name says it is a secret.`,
          fix: `Rename it to ${stripPublicPrefix(full)} and read it only in server code; rotate the value if it was ever deployed with the public name.`,
          key: full,
        });
      }
    });
  },
};
