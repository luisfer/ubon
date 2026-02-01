import { Rule } from '../types';

const devFileTypes = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'vue'];

const rule: Rule = {
  meta: {
    id: 'DEV005',
    category: 'development',
    severity: 'low',
    message: 'Empty return or stubbed function detected',
    fix: 'Implement the missing logic or remove the stub'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      lines.forEach((line, index) => {
        if (!/return\s*;?\s*$/.test(line.trim()) && !/return\s+(null|undefined)\s*;?/.test(line)) {
          return;
        }
        const context = lines.slice(Math.max(0, index - 2), index + 2).join(' ');
        if (!/todo|not implemented|stub/i.test(context)) {
          return;
        }
        results.push({
          line: index + 1,
          match: line.trim().slice(0, 200),
          confidence: 0.65
        });
      });
      return results;
    },
    fileTypes: devFileTypes
  }
};

export default rule;
