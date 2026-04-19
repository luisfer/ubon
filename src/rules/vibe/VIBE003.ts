import { Rule } from '../types';

/**
 * VIBE003: Incomplete implementations
 * Detects hardcoded placeholders and TODO-like patterns that suggest incomplete code
 */
const rule: Rule = {
  meta: {
    id: 'VIBE003',
    category: 'development',
    severity: 'high',
    message: 'Incomplete implementation detected (placeholder or stub)',
    fix: 'Complete the implementation or remove the placeholder code',
    impact: 'Placeholder code in production causes runtime errors or unexpected behavior'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro'],
    patterns: [
      {
        ruleId: 'VIBE003',
        confidence: 0.9,
        pattern: /throw\s+new\s+Error\s*\(\s*['"`](?:Not implemented|TODO|FIXME|Implement this|Coming soon)['"`]\s*\)/gi,
        message: 'Incomplete implementation: throws "Not implemented" error',
        severity: 'high',
        fix: 'Complete the implementation'
      },
      {
        ruleId: 'VIBE003',
        confidence: 0.85,
        pattern: /return\s+['"`](?:placeholder|TODO|FIXME|replace me|sample|example|dummy)['"`]/gi,
        message: 'Incomplete implementation: returns placeholder string',
        severity: 'high',
        fix: 'Replace placeholder with actual implementation'
      },
      {
        ruleId: 'VIBE003',
        confidence: 0.8,
        pattern: /(?:const|let|var)\s+\w+\s*=\s*['"`](?:YOUR_|REPLACE_|INSERT_|ADD_|CHANGE_)[A-Z_]+['"`]/gi,
        message: 'Incomplete implementation: placeholder constant',
        severity: 'high',
        fix: 'Replace placeholder with actual value'
      },
      {
        ruleId: 'VIBE003',
        confidence: 0.75,
        pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX):\s*implement/gi,
        message: 'Incomplete implementation: TODO comment indicates missing code',
        severity: 'medium',
        fix: 'Complete the implementation marked by TODO'
      }
    ]
  }
};

export default rule;
