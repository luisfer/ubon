import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';
// Development rules are imported via getRule function
import { getRule } from '../rules';

export class DevelopmentScanner implements Scanner {
  name = 'Development Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    const files = await glob('**/*.{js,jsx,ts,tsx,py,rb,vue}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**']
    });

    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');

        // Run all development rules
        for (const ruleId of ['DEV001', 'DEV002', 'DEV003', 'DEV004', 'DEV005']) {
          const rule = getRule(ruleId);
          if (!rule || !rule.impl.detect) continue;

          // Check if this file type is supported by this rule
          const fileExt = file.split('.').pop()?.toLowerCase();
          if (rule.impl.fileTypes && !rule.impl.fileTypes.includes(fileExt || '')) {
            continue;
          }

          try {
            const detectionResults = rule.impl.detect(content, file, lines);
            
            for (const detection of detectionResults) {
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
                  endColumn: Math.max(1, lines[detection.line - 1]?.length || 1)
                },
                severity: rule.meta.severity,
                ruleId: rule.meta.id,
                confidence: detection.confidence || 0.8,
                fix: rule.meta.fix,
                match: detection.match,
                ...(detection.fixEdits ? { fixEdits: detection.fixEdits } : {})
              });
            }
          } catch (error) {
            console.warn(`Error running rule ${ruleId} on ${file}:`, error);
          }
        }

        // Run pattern-based rules
        for (const ruleId of ['DEV001', 'DEV002', 'DEV003']) {
          const rule = getRule(ruleId);
          if (!rule || !rule.impl.patterns) continue;

          const fileExt = file.split('.').pop()?.toLowerCase();
          if (rule.impl.fileTypes && !rule.impl.fileTypes.includes(fileExt || '')) {
            continue;
          }

          for (const pattern of rule.impl.patterns) {
            lines.forEach((line, index) => {
              // Skip comments and pattern definitions
              if (line.trim().startsWith('//') || 
                  line.trim().startsWith('*') ||
                  line.includes('pattern:') ||
                  line.includes('message:')) {
                return;
              }
              
              const match = line.match(pattern.pattern);
              if (match) {
                results.push({
                  type: pattern.severity === 'high' ? 'error' : 'warning',
                  category: rule.meta.category,
                  message: pattern.message,
                  file,
                  line: index + 1,
                  range: { 
                    startLine: index + 1, 
                    startColumn: 1, 
                    endLine: index + 1, 
                    endColumn: Math.max(1, line.length)
                  },
                  severity: pattern.severity,
                  ruleId: pattern.ruleId,
                  confidence: pattern.confidence,
                  fix: pattern.fix,
                  match: match[0]?.slice(0, 200)
                });
              }
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