import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC012',
    category: 'security',
    severity: 'high',
    message: 'Stripe live secret key exposed',
    fix: 'CRITICAL: Move Stripe live keys to secure environment',
    impact: 'Live Stripe keys can be used to process payments and access customer data'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC012',
        confidence: 0.95,
        pattern: /(['"`])(?:sk_live_[a-zA-Z0-9]{99})\1/gi,
        message: 'Stripe live secret key exposed',
        severity: 'high',
        fix: 'CRITICAL: Move Stripe live keys to secure environment'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'env']
  }
};

export default rule;
