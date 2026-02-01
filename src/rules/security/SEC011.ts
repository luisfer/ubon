import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC011',
    category: 'security',
    severity: 'high',
    message: 'GitHub token exposed',
    fix: 'Use environment variables for GitHub tokens',
    impact: 'GitHub tokens allow access to repositories and can be used for supply chain attacks'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC011',
        confidence: 0.95,
        pattern: /(['"`])(?:gh[pousr]_[A-Za-z0-9_]{36,})\1/gi,
        message: 'GitHub token exposed',
        severity: 'high',
        fix: 'Use environment variables for GitHub tokens'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
