import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC010',
    category: 'security',
    severity: 'high',
    message: 'Google OAuth token exposed',
    fix: 'Use secure token storage',
    impact: 'OAuth tokens can be used to impersonate users and access their Google data'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC010',
        confidence: 0.9,
        pattern: /(['"`])(?:ya29\.|1\/\/[0-9A-Za-z_-]+)\1/gi,
        message: 'Google OAuth token exposed',
        severity: 'high',
        fix: 'Use secure token storage'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
