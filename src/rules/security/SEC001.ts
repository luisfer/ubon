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
        pattern: /(['"`])(?:sk-[A-Za-z0-9_-]{8,}|pk_test_[A-Za-z0-9_-]{6,}|pk_live_[A-Za-z0-9_-]{6,}|rk_live_[A-Za-z0-9_-]{6,}|rk_test_[A-Za-z0-9_-]{6,})\1/gi,
        message: 'Potential API key or secret token exposed',
        severity: 'high',
        fix: 'Move sensitive keys to environment variables'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
