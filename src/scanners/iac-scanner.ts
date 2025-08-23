import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../types/rules';

export class IacScanner implements Scanner {
  name = 'IaC Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    // Dockerfile checks
    const dockerFiles = await glob('**/Dockerfile', { cwd: options.directory, ignore: ['node_modules/**', 'dist/**', 'build/**', 'examples/**'] });
    for (const file of dockerFiles) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/apt-get\s+update.*apt-get\s+install/i.test(line) && !/rm\s+-rf\s+\/var\/lib\/apt\/lists\//i.test(content)) {
            const meta = RULES.DOCKER004;
            results.push({
              type: 'warning',
              category: meta.category,
              message: meta.message,
              file,
              line: i + 1,
              range: { startLine: i + 1, startColumn: 1, endLine: i + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.8,
              fix: meta.fix
            });
          }
        }
      } catch {}
    }

    // GitHub Actions workflows
    const ghaFiles = await glob('.github/workflows/**/*.y?(a)ml', { cwd: options.directory, ignore: ['node_modules/**', 'dist/**', 'build/**', 'examples/**'] });
    for (const file of ghaFiles) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/\becho\s+\$\{\{\s*secrets\.[^}]+\}\}/i.test(line)) {
            const meta = RULES.GHA001;
            results.push({
              type: 'error',
              category: meta.category,
              message: meta.message,
              file,
              line: i + 1,
              range: { startLine: i + 1, startColumn: 1, endLine: i + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.9,
              fix: meta.fix
            });
          }
        }
      } catch {}
    }

    return results;
  }
}


