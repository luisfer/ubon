import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC004',
    category: 'security',
    severity: 'medium',
    message: 'Supabase URL hardcoded in variable',
    fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_URL',
    impact: 'Hardcoded configuration prevents secure environment management'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC004',
        confidence: 0.8,
        pattern: /supabaseUrl\s*[:=]\s*['"`][^'"`]+['"`]/gi,
        message: 'Supabase URL hardcoded in variable',
        severity: 'medium',
        fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_URL'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue']
  }
};

export default rule;
