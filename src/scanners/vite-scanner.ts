import { glob } from 'glob';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Scanner, ScanResult, ScanOptions } from '../types';
import { getRule } from '../rules';

export class ViteScanner implements Scanner {
  name = 'Vite Security Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    // Check if this is a Vite project
    const viteConfigExists = existsSync(join(options.directory, 'vite.config.ts')) ||
                            existsSync(join(options.directory, 'vite.config.js'));

    const files = await glob('**/*.{js,jsx,ts,tsx,svelte}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**', 'vite.config.*']
    });

    // If no vite config, check if any files use Vite features
    if (!viteConfigExists) {
      let hasViteUsage = false;
      for (const file of files) {
        try {
          const filePath = `${options.directory}/${file}`;
          const content = readFileSync(filePath, 'utf-8');
          if (/import\.meta\.(env|glob|hot)|import\s*\(/i.test(content)) {
            hasViteUsage = true;
            break;
          }
        } catch {}
      }
      if (!hasViteUsage) {
        return results; // Skip if not a Vite project
      }
    }

    // Vite-specific rules
    const viteRuleIds = [
      'VITE001', // Client-Side Environment Variable Exposure
      'VITE002', // Development-Only Code
      'VITE003'  // Unsafe Dynamic Imports
    ];

    for (const file of files) {
      try {
        const filePath = `${options.directory}/${file}`;
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Check if file uses Vite-specific features
        const hasViteUsage = /import\.meta\.(env|glob|hot)|import\s*\(/i.test(content);

        // If no vite.config, only scan files with Vite usage
        if (!viteConfigExists && !hasViteUsage) {
          continue;
        }

        // Skip non-Vite files in node_modules
        if (!hasViteUsage && file.includes('node_modules')) {
          continue;
        }

        // Apply each Vite rule
        for (const ruleId of viteRuleIds) {
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
