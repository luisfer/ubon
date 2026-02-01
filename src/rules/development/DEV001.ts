import { Rule } from '../types';

const devFileTypes = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'vue'];

const rule: Rule = {
  meta: {
    id: 'DEV001',
    category: 'development',
    severity: 'medium',
    message: 'TODO/FIXME comments detected',
    fix: 'Remove TODO/FIXME comments before production'
  },
  impl: {
    patterns: [
      {
        ruleId: 'DEV001',
        confidence: 0.8,
        pattern: /\b(TODO|FIXME|HACK|XXX)\b/i,
        message: 'TODO/FIXME comments detected',
        severity: 'medium',
        fix: 'Remove TODO/FIXME comments before production'
      }
    ],
    fileTypes: devFileTypes
  }
};

export default rule;
