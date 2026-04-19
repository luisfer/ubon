import { Rule, RuleMeta } from './types';
import { securityRules } from './security';
import { accessibilityRules } from './accessibility';
import { developmentRules } from './development';
import { linksRules } from './links';
import { lovableRules } from './lovable';
import { viteRules } from './vite';
import { reactRules } from './react';
import { vibeRules } from './vibe';
import { aiRules } from './ai';
import { frameworkRules } from './frameworks';

// Combine all modular rules from different categories
const allRuleModules = {
  ...securityRules,
  ...accessibilityRules,
  ...developmentRules,
  ...linksRules,
  ...lovableRules,
  ...viteRules,
  ...reactRules,
  ...vibeRules,
  ...aiRules,
  ...frameworkRules
};

// Create rules registry (compatible with existing RULES interface)
export const RULES: Record<string, RuleMeta> = {};
export const RULE_IMPLEMENTATIONS: Record<string, Rule> = {};

// Populate registries with modular rules first
for (const [id, rule] of Object.entries(allRuleModules)) {
  const typedRule = rule as Rule;
  RULES[id] = typedRule.meta;
  RULE_IMPLEMENTATIONS[id] = typedRule;
}

// Helper functions
export function getRule(id: string): Rule | undefined {
  return RULE_IMPLEMENTATIONS[id];
}

export function getRulesByCategory(category: string): Rule[] {
  return Object.values(RULE_IMPLEMENTATIONS).filter(rule => rule.meta.category === category);
}

export function getAllRuleIds(): string[] {
  return Object.keys(RULES);
}

export function isModularRule(id: string): boolean {
  return allRuleModules.hasOwnProperty(id);
}

// Re-export types for convenience
export * from './types';