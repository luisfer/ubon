import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC009',
    category: 'security',
    severity: 'high',
    message: 'AWS Access Key ID exposed',
    fix: 'Move AWS credentials to environment variables',
    impact: 'AWS credentials can be used to access and bill your cloud resources'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC009',
        confidence: 0.95,
        pattern: /(['"`])(?:AKIA[0-9A-Z]{16})\1/gi,
        message: 'AWS Access Key ID exposed',
        severity: 'high',
        fix: 'Move AWS credentials to environment variables'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'vue', 'env']
  }
};

export default rule;
