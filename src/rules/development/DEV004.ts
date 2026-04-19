import { Rule } from '../types';

const devFileTypes = ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro'];

const rule: Rule = {
  meta: {
    id: 'DEV004',
    category: 'development',
    severity: 'low',
    message: 'Hardcoded mock/example data detected',
    fix: 'Replace mock data with real data sources'
  },
  impl: {
    patterns: [
      {
        ruleId: 'DEV004',
        confidence: 0.7,
        pattern: /\b(mockData|dummyData|sampleData|exampleData|lorem ipsum)\b/i,
        message: 'Hardcoded mock/example data detected',
        severity: 'low',
        fix: 'Replace mock data with real data sources'
      }
    ],
    fileTypes: devFileTypes
  }
};

export default rule;
