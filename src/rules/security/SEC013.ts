import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC013',
    category: 'security',
    severity: 'medium',
    message: 'Stripe live publishable key exposed',
    fix: 'Use environment variable for Stripe keys',
    impact: 'Exposed payment keys can be used to initiate unauthorized transactions'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC013',
        confidence: 0.9,
        pattern: /(['"`])(?:pk_live_[a-zA-Z0-9]{99})\1/gi,
        message: 'Stripe live publishable key exposed',
        severity: 'medium',
        fix: 'Use environment variable for Stripe keys'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'env']
  }
};

export default rule;
