import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC005',
    category: 'security',
    severity: 'high',
    message: 'Supabase key hardcoded in variable',
    fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY',
    impact: 'Database credentials in code can be extracted and misused'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC005',
        confidence: 0.9,
        pattern: /supabaseKey\s*[:=]\s*['"`][^'"`]+['"`]/gi,
        message: 'Supabase key hardcoded in variable',
        severity: 'high',
        fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue']
  }
};

export default rule;
