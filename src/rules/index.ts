import { agentRules } from './agent/index.ts';
import { ciRules } from './ci/index.ts';
import { dataRules } from './data/index.ts';
import { depsRules } from './deps/index.ts';
import { hygieneRules } from './hygiene/index.ts';
import { integrityRules } from './integrity/index.ts';
import { llmRules } from './llm/index.ts';
import { secretRules } from './secret/index.ts';
import type { Rule } from './types.ts';
import { webRules } from './web/index.ts';

/** Every rule, in catalog order. Hook rules are included for listing and config validation. */
export const RULES: readonly Rule[] = [
  ...secretRules,
  ...webRules,
  ...dataRules,
  ...llmRules,
  ...depsRules,
  ...agentRules,
  ...ciRules,
  ...integrityRules,
  ...hygieneRules,
];

let ids: ReadonlySet<string> | null = null;

export function ruleIds(): ReadonlySet<string> {
  if (!ids) ids = new Set(RULES.map((r) => r.meta.id));
  return ids;
}

export function ruleById(id: string): Rule | undefined {
  return RULES.find((r) => r.meta.id === id);
}
