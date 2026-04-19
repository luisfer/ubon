import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC007',
    category: 'security',
    severity: 'high',
    message: 'Database URL hardcoded',
    fix: 'Use environment variable for database connection',
    impact: 'Database credentials allow complete access to your data if compromised'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC007',
        confidence: 0.85,
        pattern: /DATABASE_URL\s*[:=]\s*['"`][^'"`]+['"`]/gi,
        message: 'Database URL hardcoded',
        severity: 'high',
        fix: 'Use environment variable for database connection'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'env']
  }
};

export default rule;
