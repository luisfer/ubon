import type { Rule } from '../types.ts';

/**
 * The engine reports these two itself, because they depend on how
 * suppressions matched findings. They are rules so they can be configured,
 * listed, and explained like any other.
 */

export const invalidSuppression: Rule = {
  meta: {
    id: 'integrity/invalid-suppression',
    level: 'warn',
    scope: 'file',
    title: 'Suppression without a valid reason',
    summary: 'An ubon-ignore comment that names no rule, an unknown rule, or no reason in the form `<who decided>: <evidence>`.',
    why: 'A suppression is a claim that a finding is wrong or accepted. Without a reason nobody can check the claim later, so Ubon ignores the comment and keeps the finding.',
    fix: 'Write it as `ubon-ignore <rule>: <who decided>: <evidence>`, or remove it.',
  },
};

export const unusedSuppression: Rule = {
  meta: {
    id: 'integrity/unused-suppression',
    level: 'warn',
    scope: 'file',
    title: 'Suppression that no longer matches a finding',
    summary: 'An ubon-ignore comment whose rule no longer reports anything on that line. Reported in full audits (`--all`) only.',
    why: 'Stale suppressions hide future findings on the same line and make the list of accepted risks harder to review.',
    fix: 'Remove the comment.',
  },
};
