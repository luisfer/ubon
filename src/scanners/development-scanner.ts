import { ScanResult, ScanOptions } from '../types';
import { BaseScanner } from './base-scanner';
import { getRule } from '../rules';

export class DevelopmentScanner extends BaseScanner {
  name = 'Development Scanner';
  private readonly ruleIds = ['DEV001', 'DEV002', 'DEV003', 'DEV004', 'DEV005'];

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const rules = this.ruleIds.map((id) => getRule(id)).filter(Boolean);

    for await (const ctx of this.iterateFiles(options, '**/*.{js,jsx,ts,tsx,py,rb,vue}', ['node_modules/**', 'dist/**', 'build/**', '.next/**'])) {
      const fileExt = ctx.file.split('.').pop()?.toLowerCase();
      if (this.hasFileSuppression(ctx.lines)) continue;

      for (const rule of rules) {
        if (!rule) continue;
        if (rule.impl.fileTypes && !rule.impl.fileTypes.includes(fileExt || '')) continue;

        if (rule.impl.detect) {
          try {
            const detectionResults = rule.impl.detect(ctx.content, ctx.file, ctx.lines);
            for (const detection of detectionResults) {
              if (this.isSuppressed(ctx.lines, detection.line - 1, rule.meta.id)) continue;
              results.push(this.createResult({
                type: rule.meta.severity === 'high' ? 'error' : 'warning',
                category: rule.meta.category,
                message: rule.meta.message,
                file: ctx.file,
                line: detection.line,
                severity: rule.meta.severity,
                ruleId: rule.meta.id,
                confidence: detection.confidence || 0.8,
                fix: rule.meta.fix,
                match: detection.match,
                ...(detection.fixEdits ? { fixEdits: detection.fixEdits } : {})
              }, ctx.lines[detection.line - 1]));
            }
          } catch (error) {
            console.warn(`Error running rule ${rule.meta.id} on ${ctx.file}:`, error);
          }
        }

        if (rule.impl.patterns) {
          for (const pattern of rule.impl.patterns) {
            ctx.lines.forEach((line, index) => {
              if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
              if (this.isSuppressed(ctx.lines, index, pattern.ruleId)) return;
              const match = line.match(pattern.pattern);
              if (!match) return;
              results.push(this.createResult({
                type: pattern.severity === 'high' ? 'error' : 'warning',
                category: rule.meta.category,
                message: pattern.message,
                file: ctx.file,
                line: index + 1,
                severity: pattern.severity,
                ruleId: pattern.ruleId,
                confidence: pattern.confidence,
                fix: pattern.fix,
                match: match[0]?.slice(0, 200)
              }, line));
            });
          }
        }
      }
    }

    return results;
  }
}