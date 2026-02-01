import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC002',
    category: 'security',
    severity: 'medium',
    message: 'Supabase URL hardcoded (should use env var)',
    fix: 'Use NEXT_PUBLIC_SUPABASE_URL environment variable',
    impact: 'Hardcoded URLs make it difficult to manage different environments securely'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC002',
        confidence: 0.8,
        pattern: /(['"`])https:\/\/[a-zA-Z0-9]+\.supabase\.co\1/gi,
        message: 'Supabase URL hardcoded (should use env var)',
        severity: 'medium',
        fix: 'Use NEXT_PUBLIC_SUPABASE_URL environment variable'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
