/**
 * Examples shown by `ubon explain`, extracted from the rule fixtures by
 * scripts/gen-docs.mjs. Do not edit by hand; run `npm run gen`.
 */

export interface RuleExample {
  file: string;
  code: string;
  note?: string;
}

export const EXAMPLES: Record<string, { flagged: RuleExample[]; safe: RuleExample[] }> = {};
