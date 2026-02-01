import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC014',
    category: 'security',
    severity: 'high',
    message: 'OpenAI API key exposed',
    fix: 'Use OPENAI_API_KEY environment variable',
    impact: 'OpenAI keys can be stolen and used to run up charges on your account',
    helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC014',
        confidence: 0.95,
        pattern: /(['"`])(?:sk-[a-zA-Z0-9]{48})\1/gi,
        message: 'OpenAI API key exposed',
        severity: 'high',
        fix: 'Use OPENAI_API_KEY environment variable'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
