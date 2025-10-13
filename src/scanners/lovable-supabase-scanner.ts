import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';
import { getRule } from '../rules';

export class LovableSupabaseScanner implements Scanner {
  name = 'Lovable Supabase Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    const files = await glob('**/*.{js,jsx,ts,tsx,sql}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });

    // Lovable-specific rules
    const lovableRuleIds = [
      'LOVABLE001', // Missing RLS Policy
      'LOVABLE002', // Exposed Supabase Keys
      'LOVABLE003', // Anonymous Auth Without RLS
      'LOVABLE004', // SQL Injection
      'LOVABLE005', // Weak RLS Patterns
      'LOVABLE006'  // Storage Access Control
    ];

    for (const file of files) {
      try {
        const filePath = `${options.directory}/${file}`;
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Check if file contains Supabase usage (or is a .sql file for RLS policies)
        const hasSupabaseImport = /from\s+['"]@supabase\/supabase-js['"]|import.*createClient.*from.*@supabase|supabase\s*\.|\.from\(|\.storage\.from\(|\.rpc\(|signInAnonymously|enableAnonymousSignIn|eyJ[A-Za-z0-9._-]{20,}/i.test(content);
        const isSqlFile = file.endsWith('.sql');

        if (!hasSupabaseImport && !isSqlFile) {
          continue; // Skip files without Supabase usage
        }

        // Apply each Lovable rule
        for (const ruleId of lovableRuleIds) {
          const rule = getRule(ruleId);
          if (!rule || !rule.impl.detect) continue;

          // Check file type restrictions
          if (rule.impl.fileTypes) {
            const fileExt = file.split('.').pop() || '';
            if (!rule.impl.fileTypes.includes(fileExt)) continue;
          }

          // Run detection
          const detections = rule.impl.detect(content, file, lines);

          // Convert detections to ScanResults
          for (const detection of detections) {
            const line = lines[detection.line - 1] || '';

            results.push({
              type: rule.meta.severity === 'high' ? 'error' : 'warning',
              category: rule.meta.category,
              message: rule.meta.message,
              file,
              line: detection.line,
              range: {
                startLine: detection.line,
                startColumn: 1,
                endLine: detection.line,
                endColumn: Math.max(1, line.length)
              },
              severity: rule.meta.severity,
              ruleId: rule.meta.id,
              confidence: detection.confidence || 0.85,
              match: detection.match,
              fix: rule.meta.fix,
              helpUri: rule.meta.helpUri,
              ...(detection.fixEdits ? { fixEdits: detection.fixEdits } : {})
            });
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return results;
  }
}
