import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'DEV005',
    category: 'development',
    severity: 'medium',
    message: 'Function returns null or empty objects without implementation',
    fix: 'Implement actual business logic',
    impact: 'Empty return values cause undefined behavior and UI rendering issues',
    helpUri: 'https://docs.ubon.dev/rules/DEV005'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      let inFunction = false;
      let functionStart = 0;
      
      lines.forEach((line, index) => {
        // Detect function declarations
        if (/^(export\s+)?(async\s+)?function|const\s+\w+\s*=\s*(async\s+)?\(/.test(line.trim())) {
          inFunction = true;
          functionStart = index;
        }
        
        // Detect function end
        if (inFunction && /^\s*\}/.test(line)) {
          inFunction = false;
        }
        
        if (inFunction) {
          // Look for suspicious empty returns
          const emptyPatterns = [
            /return\s+null\s*;?\s*$/,
            /return\s+\{\}\s*;?\s*$/,
            /return\s+\[\]\s*;?\s*$/,
            /return\s+undefined\s*;?\s*$/,
            /return\s*;?\s*$/
          ];
          
          for (const pattern of emptyPatterns) {
            if (pattern.test(line.trim())) {
              // Check if this looks like a placeholder (short function)
              const functionLength = index - functionStart;
              if (functionLength <= 5) { // Very short function
                results.push({
                  line: index + 1,
                  match: line.trim(),
                  confidence: 0.7
                });
              }
              break;
            }
          }
        }
      });
      
      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'py', 'rb']
  }
};

export default rule;


