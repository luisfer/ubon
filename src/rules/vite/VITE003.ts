import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'VITE003',
    category: 'security',
    severity: 'high',
    message: 'Unsafe dynamic import with user input - potential path traversal',
    fix: 'Use a whitelist of allowed module names before dynamic import',
    helpUri: 'https://vitejs.dev/guide/features.html#dynamic-import',
    impact: 'Unvalidated dynamic imports can allow attackers to load arbitrary modules or traverse the file system.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Pattern: import() with template literals containing variables
      const dynamicImportPattern = /import\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/gi;
      let match;

      while ((match = dynamicImportPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Check if there's validation nearby (within 3 lines before)
        const startCheck = Math.max(0, lineNumber - 4);
        const contextLines = lines.slice(startCheck, lineNumber);
        const hasValidation = contextLines.some(l =>
          /whitelist|allowed|includes\(|indexOf\(|switch\s*\(/i.test(l) ||
          /\b(validate|check|verify).*module/i.test(l)
        );

        if (!hasValidation) {
          results.push({
            line: lineNumber,
            match: match[0].slice(0, 100),
            confidence: 0.88
          });
        }
      }

      // Pattern: import() with string concatenation
      const concatImportPattern = /import\s*\(\s*['"][^'"]*['"]\s*\+[^)]+\)/gi;

      while ((match = concatImportPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Check if there's validation nearby (within 3 lines before)
        const startCheck = Math.max(0, lineNumber - 4);
        const contextLines = lines.slice(startCheck, lineNumber);
        const hasValidation = contextLines.some(l =>
          /whitelist|allowed|includes\(|indexOf\(|switch\s*\(/i.test(l) ||
          /\b(validate|check|verify).*module/i.test(l)
        );

        if (!hasValidation) {
          results.push({
            line: lineNumber,
            match: match[0].slice(0, 100),
            confidence: 0.88
          });
        }
      }

      // Pattern: import.meta.glob with user input
      const globPattern = /import\.meta\.glob\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/gi;

      while ((match = globPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        results.push({
          line: lineNumber,
          match: match[0].slice(0, 100),
          confidence: 0.92
        });
      }

      // Pattern: Check for path traversal attempts in dynamic imports
      lines.forEach((line, index) => {
        if (/import\s*\(/.test(line) && /\$\{.*\}/.test(line)) {
          // Check if path could contain ../ or absolute paths
          if (/\.\.|\/\//i.test(line) || /file|path|route/i.test(line)) {
            // Check for validation
            const contextLines = lines.slice(Math.max(0, index - 3), index);
            const hasValidation = contextLines.some(l =>
              /normalize|resolve|basename|sanitize/i.test(l)
            );

            if (!hasValidation) {
              results.push({
                line: index + 1,
                match: line.trim().slice(0, 100),
                confidence: 0.85
              });
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
