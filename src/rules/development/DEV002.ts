import { Rule } from '../types';

const devFileTypes = ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro'];

const rule: Rule = {
  meta: {
    id: 'DEV002',
    category: 'development',
    severity: 'medium',
    message: '"Not implemented" stub found',
    fix: 'Implement the function logic or remove unused stubs'
  },
  impl: {
    patterns: [
      {
        ruleId: 'DEV002',
        confidence: 0.8,
        pattern: /\b(not implemented|not_implemented|unimplemented)\b/i,
        message: '"Not implemented" stub found',
        severity: 'medium',
        fix: 'Implement the function logic or remove unused stubs'
      },
      {
        ruleId: 'DEV002',
        confidence: 0.75,
        pattern: /throw\s+new\s+Error\(\s*['"`]not implemented['"`]\s*\)/i,
        message: '"Not implemented" stub found',
        severity: 'medium',
        fix: 'Implement the function logic or remove unused stubs'
      }
    ],
    fileTypes: devFileTypes
  }
};

export default rule;
