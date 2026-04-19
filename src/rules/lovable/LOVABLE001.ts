import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'LOVABLE001',
    category: 'security',
    severity: 'high',
    message: 'Supabase table accessed without RLS policy validation',
    fix: 'Add RLS policy in Supabase dashboard and document with comment: // RLS enabled for {tableName}',
    helpUri: 'https://supabase.com/docs/guides/auth/row-level-security',
    impact: 'Missing RLS can expose all table data to any authenticated user, including PII, financial records, and sensitive information.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];
      const tableAccessPattern = /\.from\(['"`](\w+)['"`]\)\s*\.\s*(select|insert|update|delete|upsert)/gi;

      let match;
      while ((match = tableAccessPattern.exec(content)) !== null) {
        const _tableName = match[1];

        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Check if there's RLS documentation nearby (within 5 lines before)
        const startCheck = Math.max(0, lineNumber - 6);
        const contextLines = lines.slice(startCheck, lineNumber);
        const hasRLSComment = contextLines.some(l =>
          /RLS\s+(enabled|policy|configured)/i.test(l) ||
          /Row\s+Level\s+Security/i.test(l) ||
          /auth\.uid\(\)/i.test(l)
        );

        if (!hasRLSComment) {
          results.push({
            line: lineNumber,
            match: match[0],
            confidence: 0.85
          });
        }
      }

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
