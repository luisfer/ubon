import { RULES } from '../../../rules';
import { ScanResult } from '../../../types';

interface NetworkCookieExecutorInput {
  file: string;
  lines: string[];
}

function toRange(lineNumber: number, line: string): { startLine: number; startColumn: number; endLine: number; endColumn: number } {
  return {
    startLine: lineNumber,
    startColumn: 1,
    endLine: lineNumber,
    endColumn: Math.max(1, line.length)
  };
}

export function runNetworkAndCookieChecks({ file, lines }: NetworkCookieExecutorInput): ScanResult[] {
  const results: ScanResult[] = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const range = toRange(lineNumber, line);

    // axios without timeout
    if (/axios\.(get|post|put|delete|patch)\(/i.test(line) && !/timeout\s*:/i.test(line)) {
      const meta = RULES.JSNET001;
      results.push({
        type: meta.severity === 'high' ? 'error' : 'warning',
        category: meta.category,
        message: meta.message,
        file,
        line: lineNumber,
        range,
        severity: meta.severity,
        ruleId: meta.id,
        match: line.slice(0, 200),
        confidence: 0.7,
        confidenceReason: 'axios call without timeout option - requests can hang indefinitely',
        fix: meta.fix
      });
    }

    // fetch without AbortController/timeout wrappers (heuristic)
    if (/\bfetch\s*\(/.test(line) && !/AbortController|signal\s*:/.test(line)) {
      const meta = RULES.JSNET001;
      const suggested = line.replace(/fetch\(([^)]*)\)/, 'fetch($1, { signal })');
      const fixEdits = [{
        file,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: Math.max(1, line.length),
        replacement: suggested
      }];
      results.push({
        type: meta.severity === 'high' ? 'error' : 'warning',
        category: meta.category,
        message: meta.message,
        file,
        line: lineNumber,
        range,
        severity: meta.severity,
        ruleId: meta.id,
        match: line.slice(0, 200),
        confidence: 0.6,
        confidenceReason: 'fetch() without AbortController signal - lower confidence as signal may be added elsewhere',
        fix: 'Use AbortController with a timeout to cancel long fetches',
        fixEdits
      });
    }

    // Set-Cookie missing attributes (with fix edits)
    if (/setHeader\(\s*['"][Ss]et-[Cc]ookie['"],\s*['"][^'"]+['"]\s*\)/.test(line) || /Set-Cookie:/i.test(line)) {
      const cookieStrMatch = line.match(/Set-Cookie:\s*([^;]+(?:;[^;]+)*)/i);
      const cookieStr = cookieStrMatch ? cookieStrMatch[1] : line;
      const hasHttpOnly = /HttpOnly/i.test(cookieStr);
      const hasSecure = /Secure/i.test(cookieStr);
      const hasSameSite = /SameSite/i.test(cookieStr);
      if (!(hasHttpOnly && hasSecure && hasSameSite)) {
        const meta = RULES.COOKIE001;
        const needed = `${hasHttpOnly ? '' : '; HttpOnly'}${hasSecure ? '' : '; Secure'}${hasSameSite ? '' : '; SameSite=Lax'}`;
        const fixedLine = line.replace(/(['"])\s*\)\s*;?$/, `${needed}$1)`);
        const fixEdits = [{
          file,
          startLine: lineNumber,
          startColumn: 1,
          endLine: lineNumber,
          endColumn: Math.max(1, line.length),
          replacement: fixedLine
        }];
        results.push({
          type: meta.severity === 'high' ? 'error' : 'warning',
          category: meta.category,
          message: meta.message,
          file,
          line: lineNumber,
          range,
          severity: meta.severity,
          ruleId: meta.id,
          match: line.slice(0, 200),
          confidence: 0.8,
          confidenceReason: 'Cookie missing security attributes (HttpOnly, Secure, SameSite)',
          fix: meta.fix,
          fixEdits
        });
      }
    }

    // Insecure JWT cookies
    const isJwtCookie = /(Set-Cookie|setHeader\(\s*['"][Ss]et-[Cc]ookie['"])|setCookie\s*\(/.test(line) && /(jwt|token)=/i.test(line);
    const missingHttpOnly = !/HttpOnly/i.test(line);
    const missingSecure = !/Secure/i.test(line);
    if (isJwtCookie && (missingHttpOnly || missingSecure)) {
      const meta = RULES.COOKIE002;
      const addition = `${missingHttpOnly ? '; HttpOnly' : ''}${missingSecure ? '; Secure' : ''}`;
      const fixed = line.replace(/(['"])\s*\)\s*;?$/, `${addition}$1)`);
      const fixEdits = [{
        file,
        startLine: lineNumber,
        startColumn: 1,
        endLine: lineNumber,
        endColumn: Math.max(1, line.length),
        replacement: fixed
      }];
      results.push({
        type: 'error',
        category: meta.category,
        message: meta.message,
        file,
        line: lineNumber,
        range,
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.9,
        fix: meta.fix,
        fixEdits
      });
    }
  });

  return results;
}
