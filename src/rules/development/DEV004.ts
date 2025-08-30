import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'DEV004',
    category: 'development',
    severity: 'medium',
    message: 'Hardcoded mock/example data in API responses',
    fix: 'Replace with dynamic data from database or external API',
    impact: 'Mock data creates unrealistic user experience and testing scenarios',
    helpUri: 'https://docs.ubon.dev/rules/DEV004'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      lines.forEach((line, index) => {
        // Look for obvious mock data patterns
        const mockPatterns = [
          /return\s*\[\s*\{\s*id:\s*1,.*name.*john.*doe/gi,
          /mockUsers?|dummyData|sampleData|testData/gi,
          /email.*test@example\.com/gi,
          /return\s*\{\s*users?:\s*\[.*\{\s*name.*"(john|jane|bob|alice)"/gi
        ];
        
        for (const pattern of mockPatterns) {
          const match = pattern.exec(line);
          if (match) {
            results.push({
              line: index + 1,
              match: match[0].slice(0, 100),
              confidence: 0.8
            });
            break; // Only report one match per line
          }
        }
      });
      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'py', 'rb']
  }
};

export default rule;


