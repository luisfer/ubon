import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanOptions, ScanResult } from '../types';

export class RailsSecurityScanner implements Scanner {
  name = 'Rails Security Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    const files = await glob('**/*.{rb,erb}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'vendor/**']
    });

    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          // SQL injection: string interpolation in where
          if (line.includes('.where(') && line.includes('#{')) {
            results.push({
              type: 'error',
              category: 'security',
              message: 'Potential SQL injection via string interpolation in where()',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'high',
              ruleId: 'RAILS001',
              confidence: 0.9,
              fix: 'Use parameterized queries: where("name = ?", params[:name])'
            });
          }
          // SQL injection: find_by_sql with interpolation or concatenation
          if ((line.includes('.find_by_sql(') && line.includes('#{')) || /\.find_by_sql\(.*\+\s*params\[/.test(line)) {
            results.push({
              type: 'error',
              category: 'security',
              message: 'Potential SQL injection in find_by_sql()',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'high',
              ruleId: 'RAILS001',
              confidence: 0.85,
              fix: 'Use sanitized SQL or parameterization'
            });
          }
          // Command injection via system/backticks
          if (/(system\s*\(|`.+`)/.test(line)) {
            results.push({
              type: 'error',
              category: 'security',
              message: 'Potential command injection (system/backticks)',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'high',
              ruleId: 'RAILS002',
              confidence: 0.8,
              fix: 'Avoid shell execution or sanitize inputs thoroughly'
            });
          }
          // YAML.load without safe_load
          if (/YAML\.load\s*\(/.test(line)) {
            results.push({
              type: 'warning',
              category: 'security',
              message: 'YAML.load is unsafe; use YAML.safe_load',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'medium',
              ruleId: 'RAILS003',
              confidence: 0.8,
              fix: 'Use YAML.safe_load with permitted classes'
            });
          }
          // ERB html_safe XSS risk
          if (/<%=\s*.*\.html_safe\s*%>/.test(line)) {
            results.push({
              type: 'warning',
              category: 'security',
              message: 'html_safe used in ERB (XSS risk)',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'medium',
              ruleId: 'RAILS004',
              confidence: 0.7,
              fix: 'Avoid html_safe; ensure content is sanitized'
            });
          }
          // ERB raw output <%== %>
          if (/<%==\s*.*%>/.test(line)) {
            results.push({
              type: 'warning',
              category: 'security',
              message: 'Raw ERB output (<%==) can lead to XSS',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'medium',
              ruleId: 'RAILS004',
              confidence: 0.7,
              fix: 'Use escaped output <%= %> and sanitize'
            });
          }
          // Mass assignment
          if (/\b(create|update)\(\s*params\[[^\]]+\]\s*\)/.test(line)) {
            results.push({
              type: 'warning',
              category: 'security',
              message: 'Potential mass assignment from params',
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: 'medium',
              ruleId: 'RAILS005',
              confidence: 0.7,
              fix: 'Use strong parameters (params.require(...).permit(...))'
            });
          }
        });
        // Whole-file SQLi checks (multi-line resilience)
        const sqlInterpPatterns = [
          { re: /\.where\([\s\S]*?#\{[\s\S]*?\)/g, ruleId: 'RAILS001', msg: 'Potential SQL injection via string interpolation in where()' },
          { re: /\.find_by_sql\([\s\S]*?#\{[\s\S]*?\)/g, ruleId: 'RAILS001', msg: 'Potential SQL injection in find_by_sql()' }
        ];
        for (const pat of sqlInterpPatterns) {
          let m: RegExpExecArray | null;
          while ((m = pat.re.exec(content)) !== null) {
            const pos = m.index;
            const before = content.slice(0, pos);
            const lineNum = before.split('\n').length;
            results.push({
              type: 'error',
              category: 'security',
              message: pat.msg,
              file,
              line: lineNum,
              range: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 200 },
              severity: 'high',
              ruleId: 'RAILS001',
              confidence: 0.85,
              fix: 'Use parameterized queries instead of string interpolation'
            });
          }
        }
        // Broad heuristic: same-file presence of interpolation and where/find_by_sql
        if ((content.includes('.where(') && content.includes('#{')) || (content.includes('find_by_sql(') && content.includes('#{'))) {
          results.push({
            type: 'error',
            category: 'security',
            message: 'Potential SQL injection via string interpolation in SQL',
            file,
            line: 1,
            range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
            severity: 'high',
            ruleId: 'RAILS001',
            confidence: 0.7,
            fix: 'Use parameterized queries'
          });
        }
      } catch {
        // skip unreadable files
      }
    }

    return results;
  }
}


