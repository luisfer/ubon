import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'VITE001',
    category: 'security',
    severity: 'high',
    message: 'Environment variable without VITE_ prefix may expose secrets to client',
    fix: 'Rename to VITE_{varName} in .env if safe to expose, or keep server-side only',
    helpUri: 'https://vitejs.dev/guide/env-and-mode.html#env-variables',
    impact: 'Exposed secrets in client bundles can be extracted by anyone viewing your JavaScript, leading to API abuse or unauthorized access.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Pattern: import.meta.env.SOMETHING (not prefixed with VITE_)
      const envPattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
      let match;

      while ((match = envPattern.exec(content)) !== null) {
        const varName = match[1];

        // Skip if it's a VITE_ prefixed var (those are meant for client)
        if (varName.startsWith('VITE_')) continue;

        // Skip common Vite built-ins
        if (['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL'].includes(varName)) continue;

        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        results.push({
          line: lineNumber,
          match: match[0],
          confidence: 0.92
        });
      }

      // Also check for process.env in Vite context (wrong, won't work)
      const processEnvPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

      while ((match = processEnvPattern.exec(content)) !== null) {
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const _line = lines[lineNumber - 1];

        // Only flag if this is clearly client-side code (not in /api/ or server files)
        const isClientSide = !/(\/api\/|\.server\.|server\/)/.test(file);

        if (isClientSide) {
          results.push({
            line: lineNumber,
            match: match[0],
            confidence: 0.88
          });
        }
      }

      return results;
    },
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro']
  }
};

export default rule;
