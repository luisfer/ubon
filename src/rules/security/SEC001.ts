import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC001',
    category: 'security',
    severity: 'high',
    message: 'Potential API key or secret token exposed',
    fix: 'Move sensitive keys to environment variables',
    impact: 'Exposed credentials can be stolen from source code and used to access your services',
    helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC001',
        confidence: 0.9,
        pattern: /(['"`])(?:sk-|pk_test_|pk_live_|rk_live_|rk_test_).+?\1/gi,
        message: 'Potential API key or secret token exposed',
        severity: 'high',
        fix: 'Move sensitive keys to environment variables'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'env']
  }
};

export default rule;
