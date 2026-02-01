import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'SEC017',
    category: 'security',
    severity: 'medium',
    message: 'dangerouslySetInnerHTML usage (XSS risk)',
    fix: 'Sanitize HTML content or use safer alternatives',
    impact: 'Unsanitized HTML can inject malicious scripts that steal user data',
    helpUri: 'https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html'
  },
  impl: {
    patterns: [
      {
        ruleId: 'SEC017',
        confidence: 0.8,
        pattern: /dangerouslySetInnerHTML/gi,
        message: 'dangerouslySetInnerHTML usage (XSS risk)',
        severity: 'medium',
        fix: 'Sanitize HTML content or use safer alternatives'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
