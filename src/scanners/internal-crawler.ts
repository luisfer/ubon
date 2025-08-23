import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../types/rules';

export class InternalCrawler implements Scanner {
  name = 'Internal Crawler';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    if (!options.crawlInternal) return results;
    let puppeteer: any;
    try {
      puppeteer = await import('puppeteer');
    } catch {
      // Not installed; advise
      const meta = RULES.LINK001;
      results.push({ type: 'info', category: meta.category, message: meta.message, ruleId: meta.id, severity: meta.severity, fix: meta.fix, confidence: 0.6 });
      return results;
    }
    const startUrl = options.crawlStartUrl || `http://localhost:${options.port || 3000}`;
    const maxDepth = options.crawlDepth ?? 2;
    const timeout = options.crawlTimeoutMs ?? 10000;
    const seen = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

    const browser = await puppeteer.launch({ headless: 'new' } as any);
    try {
      while (queue.length > 0) {
        const { url, depth } = queue.shift()!;
        if (seen.has(url) || depth > maxDepth) continue;
        seen.add(url);
        const page = await browser.newPage();
        try {
          page.setDefaultNavigationTimeout(timeout);
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
          const status = resp?.status() ?? 0;
          if (status >= 400 || status === 0) {
            const meta = RULES.LINK003;
            results.push({
              type: meta.severity === 'high' ? 'error' : 'warning',
              category: meta.category,
              message: `${meta.message}: ${url} (${status || 'timeout'})`,
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.8
            });
          }
          // collect same-origin links
          const anchors = await page.$$eval('a[href]', (els: any[]) => els.map((a: any) => a.getAttribute('href')));
          for (const href of anchors) {
            if (!href) continue;
            try {
              const next = new URL(href, url);
              const start = new URL(startUrl);
              if (next.origin === start.origin) queue.push({ url: next.href, depth: depth + 1 });
            } catch {}
          }
        } catch {
          const meta = RULES.LINK003;
          results.push({ type: 'warning', category: meta.category, message: `${meta.message}: ${url} (navigation error)`, severity: meta.severity, ruleId: meta.id, confidence: 0.7 });
        } finally {
          await page.close().catch(() => {});
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
    return results;
  }
}


