import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC016',
    category: 'security',
    severity: 'high',
    message: 'Use of eval() detected (security risk)',
    fix: 'Replace eval() with safer alternatives',
    impact: 'eval() can execute malicious code and is a common vector for code injection attacks',
    helpUri: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/eval'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC016',
        confidence: 0.9,
        pattern: /eval\s*\(/gi,
        message: 'Use of eval() detected (security risk)',
        severity: 'high',
        fix: 'Replace eval() with safer alternatives'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
