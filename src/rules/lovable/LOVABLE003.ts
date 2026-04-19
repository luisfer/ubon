import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'LOVABLE003',
    category: 'security',
    severity: 'medium',
    message: 'Anonymous authentication enabled without RLS policy validation',
    fix: 'Ensure RLS policies properly restrict anonymous users, or disable anonymous auth if not needed',
    helpUri: 'https://supabase.com/docs/guides/auth/auth-anonymous',
    impact: 'Anonymous users may access tables intended for authenticated users if RLS is not properly configured.'
  },
  impl: {
    detect: (content: string, _file: string, _lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Check for anonymous sign-in
      const anonymousAuthPattern = /signInAnonymously\s*\(|enableAnonymousSignIn\s*:\s*true/gi;
      let match;

      while ((match = anonymousAuthPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Check if RLS is mentioned anywhere in the file
        const hasRLSMention = /RLS|Row\s+Level\s+Security|auth\.uid\(\)/i.test(content);

        if (!hasRLSMention) {
          results.push({
            line: lineNumber,
            match: match[0],
            confidence: 0.80
          });
        }
      }

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
