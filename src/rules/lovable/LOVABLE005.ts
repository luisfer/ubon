import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'LOVABLE005',
    category: 'security',
    severity: 'medium',
    message: 'Weak RLS policy pattern detected',
    fix: 'Use auth.uid() checks to restrict access to user\'s own data: USING (auth.uid() = user_id)',
    helpUri: 'https://supabase.com/docs/guides/auth/row-level-security#policies',
    impact: 'Weak RLS policies may allow users to access other users\' data, violating privacy and security.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Look for SQL policy definitions in comments or separate .sql files
      const weakPolicyPatterns = [
        // USING (true) - always allows access
        { pattern: /USING\s*\(\s*true\s*\)/gi, confidence: 0.90 },
        // Overly broad authenticated role without auth.uid()
        { pattern: /auth\.role\(\)\s*=\s*['"`]authenticated['"`](?!.*auth\.uid\(\))/gi, confidence: 0.75 }
      ];

      // Check for CREATE POLICY without auth.uid()
      const policyPattern = /CREATE\s+POLICY[^;]+USING\s*\([^)]+\)/gis;
      let policyMatch;
      while ((policyMatch = policyPattern.exec(content)) !== null) {
        const policyText = policyMatch[0];
        // Check if policy doesn't contain auth.uid()
        if (!/auth\.uid\(\)/i.test(policyText)) {
          const beforeMatch = content.substring(0, policyMatch.index);
          const lineNumber = beforeMatch.split('\n').length;
          results.push({
            line: lineNumber,
            match: policyText.slice(0, 100),
            confidence: 0.80
          });
        }
      }

      for (const { pattern, confidence } of weakPolicyPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;

          results.push({
            line: lineNumber,
            match: match[0].slice(0, 100),
            confidence
          });
        }
      }

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'sql']
  }
};

export default rule;
