import { Rule, RuleMeta } from './types';
import { securityRules } from './security';
import { accessibilityRules } from './accessibility';
import { developmentRules } from './development';

// Import existing rules for backward compatibility
import { RULES as LEGACY_RULES } from '../types/rules';

// Combine all modular rules from different categories
const allRuleModules = {
  ...securityRules,
  ...accessibilityRules,
  ...developmentRules
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

// Add legacy rules that haven't been migrated yet
for (const [id, meta] of Object.entries(LEGACY_RULES)) {
  if (!RULES[id]) {
    RULES[id] = meta;
    // Create a minimal rule implementation for legacy rules
    RULE_IMPLEMENTATIONS[id] = {
      meta,
      impl: {
        // Legacy rules will use the existing scanner logic
        fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'rb', 'html', 'env']
      }
    };
  }
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