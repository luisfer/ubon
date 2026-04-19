import { Rule, RuleMeta } from '../types';

const make = (meta: RuleMeta, fileTypes?: string[]): Rule => ({
  meta,
  impl: {
    fileTypes: fileTypes || ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']
  }
});

/**
 * Module-hygiene pack — "shape of the code" issues that AI output frequently
 * ships: top-level side effects, async wrapper on sync body, swallowed
 * errors, loose `any` explosion. Detection lives in `AstSecurityScanner`.
 */
export const moduleRules: Record<string, Rule> = {
  MOD001: make({
    id: 'MOD001',
    category: 'development',
    severity: 'medium',
    message: 'Module-level side effect (`fs.*Sync`, `db.exec`, `fetch`) runs at import time',
    fix: 'Move the side-effect inside a function or initializer called explicitly by the caller.',
    impact:
      'Top-level side effects run on every cold-start worker, block module imports on IO, and break tree-shaking / unit testing.'
  }),
  MOD002: make({
    id: 'MOD002',
    category: 'development',
    severity: 'low',
    message: '`async function` body contains no `await` / `for await` (unnecessary wrapper)',
    fix: 'Drop `async` if the function never awaits anything; returning a value wraps it in a Promise for no reason.',
    impact:
      'Gratuitous async wraps values in Promises callers must await — noisy call sites and missed sync fast paths.'
  }),
  MOD003: make({
    id: 'MOD003',
    category: 'security',
    severity: 'medium',
    message: 'Silent `.catch(() => …)` on a DB/fetch call hides real errors from the caller',
    fix: 'Log the error (`console.error`) or rethrow; do not silently return stub data.',
    impact:
      'Swallowing errors masks outages. The UI looks "empty" instead of "broken", and SLOs miss alert thresholds.'
  }),
  MOD004: make({
    id: 'MOD004',
    category: 'development',
    severity: 'low',
    message: 'High density of `: any` annotations in a single file',
    fix: 'Replace `any` with the narrowest type you can describe (`unknown`, a generic, or a union).',
    impact:
      '`any` disables the type system completely inside the file — refactors that would have failed the build can silently break at runtime.'
  })
};
