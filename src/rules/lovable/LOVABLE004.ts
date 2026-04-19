import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'LOVABLE004',
    category: 'security',
    severity: 'high',
    message: 'Potential SQL injection in Supabase query - uses string interpolation',
    fix: "Use Supabase's query builder methods (.eq(), .filter()) instead of string interpolation",
    helpUri: 'https://supabase.com/docs/reference/javascript/using-filters',
    impact: 'SQL injection can allow attackers to bypass RLS, access unauthorized data, or modify database contents.'
  },
  impl: {
    detect: (content: string, _file: string, _lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Pattern: Template literals in .select(), .filter(), or .rpc() with variables
      const sqlInjectionPatterns = [
        // .select() with template literal containing variables
        /\.select\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/gi,
        // .filter() with template literal (single parameter)
        /\.filter\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/gi,
        // .filter() with string concatenation (three parameters)
        /\.filter\s*\(\s*['"`][^'"` ]+['"`]\s*,\s*['"`]eq['"`]\s*,\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/gi,
        // .eq() with template literal
        /\.eq\s*\(\s*['"`][^'"` ]+['"`]\s*,\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/gi,
        // .rpc() with template literal in function name
        /\.rpc\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/gi,
        // .rpc() with template literal in params
        /\.rpc\s*\(\s*['"`][^'"` ]+['"`]\s*,\s*\{[^}]*`[^`]*\$\{[^}]+\}[^`]*`[^}]*\}\s*\)/gi
      ];

      for (const pattern of sqlInjectionPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;

          results.push({
            line: lineNumber,
            match: match[0].slice(0, 100),
            confidence: 0.88
          });
        }
      }

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx']
  }
};

export default rule;
