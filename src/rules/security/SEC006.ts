import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC006',
    category: 'security',
    severity: 'high',
    message: 'Hardcoded password detected',
    fix: 'Use environment variables for passwords',
    impact: 'Passwords in source code can be stolen by anyone with access to the codebase'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC006',
        confidence: 0.85,
        pattern: /password\s*[:=]\s*['"`][^'"`]+['"`]/gi,
        message: 'Hardcoded password detected',
        severity: 'high',
        fix: 'Use environment variables for passwords'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
