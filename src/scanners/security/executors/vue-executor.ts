import { RULES } from '../../../rules';
import { ScanResult } from '../../../types';

interface VueExecutorInput {
  file: string;
  lines: string[];
}

export function runVueSecurityChecks({ file, lines }: VueExecutorInput): ScanResult[] {
  if (!file.endsWith('.vue')) {
    return [];
  }

  const meta = RULES.VUE001;
  const results: ScanResult[] = [];

  lines.forEach((line, index) => {
    if (/v-html\s*=\s*\"|v-html\s*=\s*\'/.test(line)) {
      const lineNumber = index + 1;
      results.push({
        type: 'error',
        category: meta.category,
        message: meta.message,
        file,
        line: lineNumber,
        range: {
          startLine: lineNumber,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: Math.max(1, line.length)
        },
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.9,
        fix: meta.fix
      });
    }
  });

  return results;
}
