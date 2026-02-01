import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC008',
    category: 'security',
    severity: 'medium',
    message: 'Environment variable with hardcoded fallback',
    fix: 'Remove hardcoded fallback values',
    impact: 'Fallbacks can leak sensitive defaults and bypass environment-based security'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC008',
        confidence: 0.75,
        pattern: /process\.env\.\w+\s*\|\|\s*['"`][^'"`]+['"`]/gi,
        message: 'Environment variable with hardcoded fallback',
        severity: 'medium',
        fix: 'Remove hardcoded fallback values'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
