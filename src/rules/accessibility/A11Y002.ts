import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'A11Y002',
    category: 'accessibility',
    severity: 'medium',
    message: 'Input without label or aria-label',
    fix: 'Add proper labeling to form inputs',
    helpUri: 'https://web.dev/labels-and-text-alternatives/',
    impact: 'Users with disabilities cannot understand what the input field is for'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      lines.forEach((line, index) => {
        // Match <input> tags without label or aria-label
        const inputMatch = /<input\s+[^>]*>/gi.exec(line);
        if (inputMatch && !/(^|\s)(aria-label|aria-labelledby)\s*=/i.test(inputMatch[0])) {
          // Check if there's a label element nearby (simple heuristic)
          const hasNearbyLabel = lines.slice(Math.max(0, index - 2), index + 3)
            .some(nearLine => /<label[^>]*>/i.test(nearLine));
          
          if (!hasNearbyLabel) {
            results.push({
              line: index + 1,
              match: inputMatch[0],
              confidence: 0.8
            });
          }
        }
      });
      return results;
    },
    fileTypes: ['jsx', 'tsx', 'vue', 'html']
  }
};

export default rule;