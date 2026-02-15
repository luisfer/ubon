import { Rule } from '../../../rules/types';
import { ScanResult } from '../../../types';

interface ModularRuleExecutorInput {
  file: string;
  fileExt: string;
  lines: string[];
  rules: Rule[];
  confidenceReasons: Record<string, string>;
}

const SECRET_RULE_IDS = new Set(['SEC001', 'SEC003', 'SEC009', 'SEC011', 'SEC014']);

function hasSuppression(lines: string[], lineIndex: number, ruleId: string): boolean {
  const disableNext = /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[lineIndex] || '');
  const prevDisable = lineIndex > 0 ? /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[lineIndex - 1]) : null;
  const disabledList = new Set<string>([
    ...(disableNext && disableNext[1] ? disableNext[1].split(/[,\s]+/).filter(Boolean) : []),
    ...(prevDisable && prevDisable[1] ? prevDisable[1].split(/[,\s]+/).filter(Boolean) : [])
  ]);
  return disabledList.has(ruleId);
}

function isSkippedContext(file: string, line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    line.includes('pattern:') ||
    line.includes('message:') ||
    line.includes('severity:') ||
    line.includes('fix:') ||
    file.includes('security-scanner.ts') ||
    file.includes('/rules/security/')
  );
}

function buildFixEdits(file: string, line: string, lineNumber: number, ruleId: string): Array<{
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  replacement: string;
}> {
  const edits: Array<{
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    replacement: string;
  }> = [];

  if (ruleId === 'SEC008') {
    const replacement = line.replace(/(process\.env\.\w+)\s*\|\|\s*['"][^'"`]+['"]/g, '$1');
    if (replacement !== line) {
      edits.push({
        file,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: Math.max(1, line.length),
        replacement
      });
    }
  }

  if (ruleId === 'SEC015') {
    edits.push({
      file,
      startLine: lineNumber,
      startColumn: 1,
      endLine: lineNumber,
      endColumn: Math.max(1, line.length),
      replacement: ''
    });
  }

  return edits;
}

export function runModularPatternRules({
  file,
  fileExt,
  lines,
  rules,
  confidenceReasons
}: ModularRuleExecutorInput): ScanResult[] {
  const results: ScanResult[] = [];

  for (const rule of rules) {
    if (rule.impl.fileTypes && !rule.impl.fileTypes.includes(fileExt)) continue;
    if (rule.impl.skipPatterns?.some((p) => p.test(file))) continue;
    if (!rule.impl.patterns) continue;

    for (const pattern of rule.impl.patterns) {
      lines.forEach((line, index) => {
        if (isSkippedContext(file, line)) return;
        if (pattern.ruleId === 'SEC015' && file.includes('logger')) return;
        if (hasSuppression(lines, index, pattern.ruleId)) return;

        const match = line.match(pattern.pattern);
        if (!match) return;

        const matchedText = match[0] || '';
        const looksLikeRegexSource = /[\[\]\{\}\\]/.test(matchedText) && /\/.+\/[gimsuy]*/.test(line);
        if (SECRET_RULE_IDS.has(pattern.ruleId) && looksLikeRegexSource) return;

        const lineNumber = index + 1;
        const fixEdits = buildFixEdits(file, line, lineNumber, pattern.ruleId);
        results.push({
          type: pattern.severity === 'high' ? 'error' : 'warning',
          category: 'security',
          message: pattern.message,
          file,
          line: lineNumber,
          range: {
            startLine: lineNumber,
            startColumn: 1,
            endLine: lineNumber,
            endColumn: Math.max(1, line.length)
          },
          match: matchedText.slice(0, 200),
          severity: pattern.severity,
          ruleId: pattern.ruleId,
          confidence: pattern.confidence,
          confidenceReason: confidenceReasons[pattern.ruleId] || 'Pattern match detected',
          fix: pattern.fix,
          ...(fixEdits.length ? { fixEdits } : {})
        });
      });
    }
  }

  return results;
}
