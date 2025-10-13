import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'LOVABLE002',
    category: 'security',
    severity: 'high',
    message: 'Supabase credentials hardcoded in source code',
    fix: 'Move to .env file (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and access via import.meta.env',
    helpUri: 'https://vitejs.dev/guide/env-and-mode.html',
    impact: 'Exposed Supabase credentials in client-side code allow attackers to abuse your API quota and access data if RLS is misconfigured.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Pattern 1: Hardcoded Supabase URL
      const urlPattern = /(['"`])https:\/\/[a-z0-9-]+\.supabase\.co\1/gi;
      let match;

      while ((match = urlPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const line = lines[lineNumber - 1];

        // Check if it's in an env var access (that's OK)
        if (!/import\.meta\.env|process\.env|Deno\.env/i.test(line)) {
          results.push({
            line: lineNumber,
            match: match[0],
            confidence: 0.95
          });
        }
      }

      // Pattern 2: Hardcoded JWT/anon key (eyJ... pattern)
      const jwtPattern = /eyJ[A-Za-z0-9._-]{30,}/gi;

      while ((match = jwtPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const line = lines[lineNumber - 1];

        // Check if it's in an env var access (that's OK)
        if (!/import\.meta\.env|process\.env|Deno\.env/i.test(line)) {
          results.push({
            line: lineNumber,
            match: match[0].slice(0, 50) + '...',
            confidence: 0.95
          });
        }
      }

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
