import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC003',
    category: 'security',
    severity: 'high',
    message: 'Supabase anon key hardcoded (JWT token pattern)',
    fix: 'Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable',
    impact: 'Exposed database keys allow unauthorized access to your Supabase instance'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC003',
        confidence: 0.95,
        pattern: /(['"`])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\1/gi,
        message: 'Supabase anon key hardcoded (JWT token pattern)',
        severity: 'high',
        fix: 'Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'env']
  }
};

export default rule;
