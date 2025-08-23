import { Scanner, ScanResult, ScanOptions } from '../types';
import { RULES } from '../types/rules';
import { glob } from 'glob';
import { readFileSync } from 'fs';
import https from 'https';
import http from 'http';

export class LinkScanner implements Scanner {
  name = 'Broken Links Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    // Find links in source files and check reachability
    const files = await glob('**/*.{md,mdx,js,jsx,ts,tsx,html}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });
    const urlRegex = /(https?:\/\/[^\s)"'<>]+)/g;
    const uniqueUrls = new Map<string, { file: string; line: number }[]>();
    for (const file of files) {
      let content = '';
      try { content = readFileSync(`${options.directory}/${file}`, 'utf-8'); } catch {}
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        let m: RegExpExecArray | null;
        const re = new RegExp(urlRegex);
        while ((m = re.exec(line)) !== null) {
          const url = m[1];
          const arr = uniqueUrls.get(url) || [];
          arr.push({ file, line: idx + 1 });
          uniqueUrls.set(url, arr);
        }
      });
    }
    const checkUrl = (url: string): Promise<number> => {
      return new Promise(resolve => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.request(url, { method: 'HEAD', timeout: 7000 }, (res) => {
          resolve(res.statusCode || 0);
          res.resume();
        });
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', () => resolve(0));
        req.end();
      });
    };
    const entries = Array.from(uniqueUrls.entries());
    const concurrency = 8;
    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency);
      const statuses = await Promise.all(batch.map(([u]) => checkUrl(u)));
      for (let j = 0; j < batch.length; j++) {
        const [url, locs] = batch[j];
        const status = statuses[j];
        if (status === 0 || status >= 400) {
          const meta = RULES.LINK002;
          for (const loc of locs) {
            results.push({
              type: meta.severity === 'high' ? 'error' : 'warning',
              category: meta.category,
              message: `${meta.message}: ${url} (${status || 'timeout'})`,
              file: loc.file,
              line: loc.line,
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.8,
              fix: meta.fix
            });
          }
        }
      }
    }
    if (results.length === 0) {
      // keep the informative suggestion about puppeteer for internal crawling
      const meta = RULES.LINK001;
      results.push({ type: 'info', category: meta.category, message: meta.message, ruleId: meta.id, severity: meta.severity, fix: meta.fix, confidence: 0.6 });
    }
    return results;
  }
}