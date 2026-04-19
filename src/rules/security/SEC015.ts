import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC015',
    category: 'security',
    severity: 'low',
    message: 'Console statement found (may leak sensitive info)',
    fix: 'Remove console statements before production',
    impact: 'Console logs can expose sensitive data in browser developer tools'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC015',
        confidence: 0.6,
        pattern: /console\.(log|debug|info|warn|error)\(/gi,
        message: 'Console statement found (may leak sensitive info)',
        severity: 'low',
        fix: 'Remove console statements before production'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro'],
    skipPatterns: [/logger/i]
  }
};

export default rule;
