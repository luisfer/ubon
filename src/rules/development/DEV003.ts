import { Rule } from '../types';

const devFileTypes = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'vue'];

const rule: Rule = {
  meta: {
    id: 'DEV003',
    category: 'development',
    severity: 'medium',
    message: 'Placeholder URL detected',
    fix: 'Replace placeholder URLs with real endpoints'
  },
  impl: {
    patterns: [
      {
        ruleId: 'DEV003',
        confidence: 0.85,
        pattern: /\b(localhost|127\.0\.0\.1|example\.com|example\.org|example\.net|your-domain\.com)\b/i,
        message: 'Placeholder URL detected',
        severity: 'medium',
        fix: 'Replace placeholder URLs with real endpoints'
      }
    ],
    fileTypes: devFileTypes
  }
};

export default rule;
