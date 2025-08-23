import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';

export class PythonSecurityScanner implements Scanner {
  name = 'Python Security Scanner';

  private readonly patterns = [
    { ruleId: 'PYSEC001', confidence: 0.9, pattern: /(['"])sk-[A-Za-z0-9_-]{16,}\1/g, message: 'Potential API key exposed', severity: 'high' as const, fix: 'Move secrets to environment variables' },
    { ruleId: 'PYSEC002', confidence: 0.9, pattern: /exec\s*\(/g, message: 'Use of exec() detected', severity: 'high' as const, fix: 'Avoid exec(); use safer alternatives' },
    { ruleId: 'PYSEC003', confidence: 0.9, pattern: /eval\s*\(/g, message: 'Use of eval() detected', severity: 'high' as const, fix: 'Avoid eval(); use safer alternatives' },
    { ruleId: 'PYSEC004', confidence: 0.85, pattern: /subprocess\.[P\w]+\(.*shell\s*=\s*True/g, message: 'subprocess with shell=True', severity: 'high' as const, fix: 'Avoid shell=True; pass args as list' },
    { ruleId: 'PYSEC005', confidence: 0.85, pattern: /yaml\.load\(/g, message: 'yaml.load() unsafe without Loader', severity: 'medium' as const, fix: 'Use yaml.safe_load()' },
    { ruleId: 'PYSEC006', confidence: 0.8, pattern: /pickle\.(load|loads)\(/g, message: 'Insecure pickle usage', severity: 'medium' as const, fix: 'Avoid pickle with untrusted data' },
    { ruleId: 'PYSEC007', confidence: 0.8, pattern: /requests\.[a-z]+\([^)]*verify\s*=\s*False/g, message: 'TLS verification disabled', severity: 'medium' as const, fix: 'Remove verify=False' },
    { ruleId: 'PYSEC008', confidence: 0.7, pattern: /except\s*:\s*pass/g, message: 'Broad except with pass', severity: 'low' as const, fix: 'Catch specific exceptions and handle properly' },
    { ruleId: 'PYSEC009', confidence: 0.8, pattern: /DEBUG\s*=\s*True/g, message: 'DEBUG=True in settings', severity: 'medium' as const, fix: 'Disable DEBUG in production' },
    { ruleId: 'PYSEC010', confidence: 0.7, pattern: /ALLOWED_HOSTS\s*=\s*\[[^\]]*\*[^\]]*\]/g, message: 'ALLOWED_HOSTS includes *', severity: 'low' as const, fix: 'Restrict ALLOWED_HOSTS' },
    { ruleId: 'PYNET001', confidence: 0.8, pattern: /requests\.[a-z]+\([^)]*\)/g, message: 'requests call without timeout', severity: 'medium' as const, fix: 'Add timeout= to requests.* calls' },
  ];

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const files = await glob('**/*.py', { cwd: options.directory, ignore: ['.venv/**', 'venv/**', 'node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**'] });
    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');
        let ubonDisableAll = false;
        lines.forEach((line, index) => {
          if (/ubon-disable-file/.test(line)) { ubonDisableAll = true; }
          if (ubonDisableAll) return;
          const disableNext = /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(line);
          for (const p of this.patterns) {
            if (p.ruleId === 'PYNET001' && /timeout\s*=\s*\d+/.test(line)) {
              continue;
            }
            if (p.pattern.test(line)) {
              if (disableNext && disableNext[1] && disableNext[1].split(/[,\s]+/).filter(Boolean).includes(p.ruleId)) {
                continue;
              }
              results.push({
                type: p.severity === 'high' ? 'error' : 'warning',
                category: 'security',
                message: p.message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                severity: p.severity,
                ruleId: p.ruleId,
                confidence: p.confidence,
                fix: p.fix
              });
            }
          }
        });
      } catch (e) {
        // ignore
      }
    }
    return results;
  }
}


