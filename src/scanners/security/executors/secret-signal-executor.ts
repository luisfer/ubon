import { RULES } from '../../../rules';
import { ScanResult } from '../../../types';
import { extractQuotedLiterals, shannonEntropy } from '../../../utils/entropy';

interface SecretSignalExecutorInput {
  file: string;
  lines: string[];
}

function lineRange(lineNumber: number, line: string): { startLine: number; startColumn: number; endLine: number; endColumn: number } {
  return {
    startLine: lineNumber,
    startColumn: 1,
    endLine: lineNumber,
    endColumn: Math.max(1, line.length)
  };
}

export function runSecretSignalChecks({ file, lines }: SecretSignalExecutorInput): ScanResult[] {
  const results: ScanResult[] = [];
  const lowerFile = file.toLowerCase();
  const isCssContext = lowerFile.endsWith('.css') || lowerFile.endsWith('.scss') || lowerFile.endsWith('.sass') || lowerFile.endsWith('.less') || lowerFile.includes('tailwind.config');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    const quoted = extractQuotedLiterals(line).filter((s) => s.length >= 16);
    for (const token of quoted) {
      const entropy = shannonEntropy(token);
      if (entropy < 3.8 || !/[A-Za-z0-9]/.test(token)) continue;
      if (isCssContext) continue;

      const isHexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(token);
      const isTailwind = /(bg|text|border|from|to|via)-[a-zA-Z]+-\d{2,3}/.test(token);
      const isDataUri = /^data:image\//.test(token);
      const isGlobLike = /\*\*?|\{.*\}|\*\.[a-zA-Z0-9]+/.test(token);
      const isUuid = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/.test(token);
      if (isHexColor || isTailwind || isDataUri || isGlobLike || isUuid) continue;

      const looksLikeSecret = /\b(sk-|pk_live_|rk_(live|test)_|eyJ[A-Za-z0-9._-]{10,}|AKIA[0-9A-Z]{16}|password=|secret=|api_key=|token=|postgres(ql)?:\/\/|mongodb:\/\/)/.test(token);
      const isDotEnvFile = /(^|\/)\.env(\.|$)/.test(lowerFile);
      if (!looksLikeSecret && !isDotEnvFile) continue;

      const meta = RULES.SEC018;
      const confidence = looksLikeSecret ? 0.9 : 0.8;
      results.push({
        type: meta.severity === 'high' ? 'error' : 'warning',
        category: meta.category,
        message: meta.message,
        file,
        line: lineNumber,
        range: lineRange(lineNumber, line),
        severity: meta.severity,
        ruleId: meta.id,
        match: token.slice(0, 200),
        confidence,
        confidenceReason: looksLikeSecret
          ? 'High entropy + matches known secret pattern (sk-, AKIA, etc.)'
          : 'High entropy string in .env file - likely a secret',
        fix: meta.fix
      });
    }

    if (/console\.(log|debug|info|warn|error)\(/.test(line) && /(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16})/.test(line)) {
      const meta = RULES.LOG001;
      const redacted = line
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-********')
        .replace(/eyJ[A-Za-z0-9._-]{20,}/g, 'eyJ********')
        .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA**************');

      results.push({
        type: 'warning',
        category: meta.category,
        message: meta.message,
        file,
        line: lineNumber,
        range: lineRange(lineNumber, line),
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.8,
        confidenceReason: 'Console statement contains string matching secret pattern',
        fix: meta.fix,
        fixEdits: [{
          file,
          startLine: lineNumber,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: Math.max(1, line.length),
          replacement: redacted
        }]
      });
    }
  });

  return results;
}
