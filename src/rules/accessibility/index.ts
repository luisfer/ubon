import { Rule } from '../types';
import A11Y001 from './A11Y001';
import A11Y002 from './A11Y002';

const a11yFileTypes = ['jsx', 'tsx', 'vue', 'html'];

const A11Y003: Rule = {
  meta: {
    id: 'A11Y003',
    category: 'accessibility',
    severity: 'high',
    message: 'Empty button without aria-label',
    fix: 'Add descriptive text or aria-label to buttons',
    helpUri: 'https://dequeuniversity.com/rules/axe/4.7/button-name',
    impact: 'Screen readers cannot announce button purpose, blocking critical actions'
  },
  impl: {
    patterns: [
      {
        ruleId: 'A11Y003',
        confidence: 0.85,
        pattern: /<button(?![^>]*aria-label)>\s*<\/button>/gi,
        message: 'Empty button without aria-label',
        severity: 'high',
        fix: 'Add descriptive text or aria-label to buttons'
      }
    ],
    fileTypes: a11yFileTypes
  }
};

const A11Y004: Rule = {
  meta: {
    id: 'A11Y004',
    category: 'accessibility',
    severity: 'medium',
    message: 'Div with onClick (not keyboard accessible)',
    fix: 'Use button element or add keyboard event handlers',
    helpUri: 'https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Roles/button_role',
    impact: 'Keyboard-only users cannot activate this interactive element'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      lines.forEach((line, index) => {
        if (!/<div[^>]*(onClick|@click|v-on:click)/i.test(line)) return;
        const hasRole = /role\s*=\s*['"]button['"]/i.test(line);
        const hasTabIndex = /tabIndex\s*=\s*\{?0\}?/i.test(line);
        if (hasRole && hasTabIndex) return;
        results.push({
          line: index + 1,
          match: line.slice(0, 200),
          confidence: 0.75,
          fixEdits: [{
            file,
            startLine: index + 1,
            startColumn: 1,
            endLine: index + 1,
            endColumn: Math.max(1, line.length),
            replacement: line.replace(/<div([^>]*)/i, (m0) => {
              if (/role=/i.test(m0)) return m0;
              return `${m0} role="button" tabIndex={0}`;
            })
          }]
        });
      });
      return results;
    },
    fileTypes: a11yFileTypes
  }
};

const A11Y005: Rule = {
  meta: {
    id: 'A11Y005',
    category: 'accessibility',
    severity: 'low',
    message: 'Link without href attribute',
    fix: 'Add href attribute or use button element',
    helpUri: 'https://dequeuniversity.com/rules/axe/4.7/link-name'
  },
  impl: {
    patterns: [
      {
        ruleId: 'A11Y005',
        confidence: 0.6,
        pattern: /<a(?![^>]*href)/gi,
        message: 'Link without href attribute',
        severity: 'low',
        fix: 'Add href attribute or use button element'
      }
    ],
    fileTypes: a11yFileTypes
  }
};

const A11Y006: Rule = {
  meta: {
    id: 'A11Y006',
    category: 'accessibility',
    severity: 'low',
    message: 'Image missing width/height attributes',
    fix: 'Specify width and height to avoid layout shifts',
    helpUri: 'https://web.dev/optimize-cls/'
  },
  impl: {
    patterns: [
      {
        ruleId: 'A11Y006',
        confidence: 0.6,
        pattern: /<img(?![^>]*\b(width|height)\s*=)/gi,
        message: 'Image missing width/height attributes',
        severity: 'low',
        fix: 'Specify width and height to avoid layout shifts'
      }
    ],
    fileTypes: a11yFileTypes
  }
};

const A11Y007: Rule = {
  meta: {
    id: 'A11Y007',
    category: 'accessibility',
    severity: 'low',
    message: 'next/image used without width and height',
    fix: 'Provide width and height props to <Image>',
    helpUri: 'https://nextjs.org/docs/pages/api-reference/components/image'
  },
  impl: {
    patterns: [
      {
        ruleId: 'A11Y007',
        confidence: 0.6,
        pattern: /<Image\b(?![^>]*\b(width|height)\s*=)/gi,
        message: 'next/image used without width and height',
        severity: 'low',
        fix: 'Provide width and height props to <Image>'
      }
    ],
    fileTypes: a11yFileTypes
  }
};

const NEXT005: Rule = {
  meta: {
    id: 'NEXT005',
    category: 'accessibility',
    severity: 'low',
    message: 'External <img> used in Next.js app (consider next/image)',
    fix: 'Use next/image for external sources with proper config'
  },
  impl: {
    patterns: [
      {
        ruleId: 'NEXT005',
        confidence: 0.6,
        pattern: /<img[^>]*src\s*=\s*["']https?:\/\//gi,
        message: 'External <img> used in Next.js app (consider next/image)',
        severity: 'low',
        fix: 'Use next/image for external sources with proper config'
      }
    ],
    fileTypes: a11yFileTypes
  }
};

export const accessibilityRules: Record<string, Rule> = {
  A11Y001,
  A11Y002,
  A11Y003,
  A11Y004,
  A11Y005,
  A11Y006,
  A11Y007,
  NEXT005
};