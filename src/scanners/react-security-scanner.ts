import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';
import { getRule } from '../rules';

export class ReactSecurityScanner implements Scanner {
  name = 'React Security Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    const files = await glob('**/*.{jsx,tsx}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });

    // React-specific security rules
    const reactRuleIds = [
      'TAILWIND001' // Dynamic className Injection
    ];

    for (const file of files) {
      try {
        const filePath = `${options.directory}/${file}`;
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Apply each React security rule
        for (const ruleId of reactRuleIds) {
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
              confidence: detection.confidence || 0.80,
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
