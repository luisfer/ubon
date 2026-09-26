import { invalidSuppression, unusedSuppression } from './integrity/suppressions.ts';
import { secretRules } from './secret/index.ts';
import type { Rule } from './types.ts';

/** Every rule, in catalog order. Hook rules are included for listing and config validation. */
export const RULES: readonly Rule[] = [...secretRules, invalidSuppression, unusedSuppression];

let ids: ReadonlySet<string> | null = null;

export function ruleIds(): ReadonlySet<string> {
  if (!ids) ids = new Set(RULES.map((r) => r.meta.id));
  return ids;
}

export function ruleById(id: string): Rule | undefined {
  return RULES.find((r) => r.meta.id === id);
}
