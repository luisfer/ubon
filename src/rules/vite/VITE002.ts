import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'VITE002',
    category: 'security',
    severity: 'medium',
    message: 'Development-only code without production fallback',
    fix: 'Add production fallback or remove development-only code',
    helpUri: 'https://vitejs.dev/guide/env-and-mode.html#modes',
    impact: 'Missing production configuration can cause app failures or expose development-only debugging information.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Pattern: Development checks without proper fallback
      const devCheckPatterns = [
        /if\s*\(\s*import\.meta\.env\.DEV\s*\)/gi,
        /if\s*\(\s*!import\.meta\.env\.PROD\s*\)/gi,
        /if\s*\(\s*import\.meta\.env\.MODE\s*===\s*['"]development['"]\s*\)/gi
      ];
      
      for (const pattern of devCheckPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;

          // Check if there's an else clause nearby (within next 5 lines)
          const endCheck = Math.min(lines.length, lineNumber + 5);
          const contextLines = lines.slice(lineNumber, endCheck).join('\n');
          const hasElse = /else\s*\{/.test(contextLines);

          if (!hasElse) {
            results.push({
              line: lineNumber,
              match: match[0],
              confidence: 0.85
            });
          }
        }
      }

      // Pattern: Ternary with undefined in production
      const ternaryPattern = /import\.meta\.env\.(DEV|MODE)\s*\?\s*[^:]+:\s*(undefined|null)\s*[;,\)]/gi;
      let match;

      while ((match = ternaryPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        results.push({
          line: lineNumber,
          match: match[0].slice(0, 80),
          confidence: 0.90
        });
      }

      // Pattern: console.log in DEV blocks that might contain sensitive data
      lines.forEach((line, index) => {
        if (/if\s*\(\s*import\.meta\.env\.DEV\s*\)/.test(line)) {
          // Check next few lines for console.log with sensitive-looking data
          const nextLines = lines.slice(index + 1, index + 5);
          for (let i = 0; i < nextLines.length; i++) {
            if (/console\.(log|debug|info).*\b(user|token|key|password|secret|auth|api)/i.test(nextLines[i])) {
              results.push({
                line: index + i + 2,
                match: nextLines[i].trim().slice(0, 100),
                confidence: 0.75
              });
              break;
            }
          }
        }
      });

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro']
  }
};

export default rule;
