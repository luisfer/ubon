import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'TAILWIND001',
    category: 'security',
    severity: 'medium',
    message: 'Dynamic className with unvalidated input - may allow CSS injection',
    fix: 'Validate className input against a whitelist of allowed Tailwind classes',
    helpUri: 'https://tailwindcss.com/docs/content-configuration#dynamic-class-names',
    impact: 'CSS injection can be used for UI spoofing, clickjacking, or exfiltrating data through CSS selectors.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      if (!/(jsx|tsx|svelte|astro)$/.test(file)) return results;

      lines.forEach((line, index) => {
        // Pattern 1: className={variable} without validation
        const classNameVarPattern = /className\s*=\s*\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*\}/g;
        let match;

        while ((match = classNameVarPattern.exec(line)) !== null) {
          const varName = match[1];

          // Skip if it's a literal string or known safe patterns
          if (varName === 'className' || varName === 'classes') continue;
          if (/^['"`]/.test(varName)) continue; // Already a string literal

          // Check if there's validation nearby (within 5 lines before)
          const startCheck = Math.max(0, index - 5);
          const contextLines = lines.slice(startCheck, index + 1);
          const hasValidation = contextLines.some(l =>
            /whitelist|allowed|includes\(|switch\s*\(/i.test(l) ||
            /^(const|let|var)\s+\w+\s*=\s*\[['"`]/.test(l) || // Array of allowed values
            /clsx\(|classnames\(|cn\(/i.test(l) // Using class utility with conditions
          );

          // Check for template literal injection
          const hasTemplateLiteral = /className\s*=\s*\{\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\}/i.test(line);

          if (!hasValidation || hasTemplateLiteral) {
            results.push({
              line: index + 1,
              match: match[0],
              confidence: hasTemplateLiteral ? 0.85 : 0.75
            });
          }
        }

        // Pattern 2: className with template literal and variables
        const templateLiteralPattern = /className\s*=\s*\{`[^`]*\$\{([^}]+)\}[^`]*`\}/g;

        while ((match = templateLiteralPattern.exec(line)) !== null) {
          const varContent = match[1];

          // Check for validation nearby (within 5 lines before)
          const startCheck = Math.max(0, index - 5);
          const contextLines = lines.slice(startCheck, index + 1);
          const hasValidation = contextLines.some(l =>
            /whitelist|allowed|includes\(|switch\s*\(/i.test(l) ||
            /^(const|let|var)\s+\w+\s*=\s*\[['"`]/.test(l) || // Array of allowed values
            /clsx\(|classnames\(|cn\(/i.test(l) // Using class utility with conditions
          );

          // Flag if no validation or if variable looks like user input
          const looksLikeUserInput = /(props|user|data|input|query|params|state)/i.test(varContent);
          
          if (!hasValidation || looksLikeUserInput) {
            results.push({
              line: index + 1,
              match: match[0],
              confidence: looksLikeUserInput ? 0.85 : 0.75
            });
          }
        }

        // Pattern 3: String concatenation in className
        const concatPattern = /className\s*=\s*\{[^}]*\+[^}]*\}/g;

        while ((match = concatPattern.exec(line)) !== null) {
          // Check if it's concatenating with variables (not just static strings)
          if (/\+\s*[a-zA-Z_$][a-zA-Z0-9_$]*|\b[a-zA-Z_$][a-zA-Z0-9_$]*\s*\+/.test(match[0])) {
            results.push({
              line: index + 1,
              match: match[0],
              confidence: 0.78
            });
          }
        }
      });

      return results;
    },
    fileTypes: ['jsx', 'tsx', 'svelte', 'astro']
  }
};

export default rule;
