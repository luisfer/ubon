import { Rule } from '../types';

const rule: Rule = {
  meta: {
    id: 'LOVABLE006',
    category: 'security',
    severity: 'medium',
    message: 'Supabase storage access without proper validation',
    fix: 'Add file size/type validation and ensure storage RLS policies are configured',
    helpUri: 'https://supabase.com/docs/guides/storage/security/access-control',
    impact: 'Unvalidated file uploads can lead to storage abuse, malware hosting, or unauthorized data access.'
  },
  impl: {
    detect: (content: string, file: string, lines: string[]) => {
      const results: import('../types').DetectionResult[] = [];

      // Pattern: .storage.from() calls (allow whitespace/newlines between .storage and .from)
      const storagePattern = /\.storage\s*\.\s*from\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi;
      let match;

      while ((match = storagePattern.exec(content)) !== null) {
        const bucketName = match[1];
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        // Check if it's a public bucket without validation
        const isPublicBucket = /public/i.test(bucketName);

        // Look for file validation nearby (within 10 lines before and after)
        const startCheck = Math.max(0, lineNumber - 10);
        const endCheck = Math.min(lines.length, lineNumber + 10);
        const contextLines = lines.slice(startCheck, endCheck);
        const hasValidation = contextLines.some(l =>
          /\.size|maxSize|fileSize|MAX_FILE_SIZE/i.test(l) ||
          /\.type|mime|content-type|allowed.*types/i.test(l) ||
          /validate/i.test(l)
        );

        if (isPublicBucket || !hasValidation) {
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
