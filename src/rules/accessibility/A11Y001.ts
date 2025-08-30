import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'A11Y001',
    category: 'accessibility',
    severity: 'medium',
    message: 'Image without alt attribute',
    fix: 'Add descriptive alt attribute to images',
    helpUri: 'https://webaim.org/techniques/alttext/',
    impact: 'Screen readers cannot describe images to visually impaired users'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      lines.forEach((line, index) => {
        // Match <img> tags without alt attribute
        const imgMatch = /<img\s+[^>]*>/gi.exec(line);
        if (imgMatch && !/(^|\s)alt\s*=/i.test(imgMatch[0])) {
          results.push({
            line: index + 1,
            match: imgMatch[0],
            confidence: 0.9,
            fixEdits: [{
              file,
              startLine: index + 1,
              startColumn: 1,
              endLine: index + 1,
              endColumn: line.length,
              replacement: line.replace(/<img(\s+[^>]*)>/gi, '<img$1 alt="">')
            }]
          });
        }
      });
      return results;
    },
    fileTypes: ['jsx', 'tsx', 'vue', 'html']
  }
};

export default rule;


