import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../rules';

export class InternalCrawler implements Scanner {
  name = 'Internal Crawler';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    if (!options.crawlInternal) return results;
    let puppeteer: any;
    try {
      // Loaded dynamically with a string-built specifier so TypeScript does
      // not require puppeteer's types to be installed (it's an optional,
      // user-provided dep — see package.json optionalDependencies docs).
      const mod = 'puppeteer';
      puppeteer = await import(mod);
    } catch {
      // Not installed; advise
      const meta = RULES.LINK001;
      results.push({ type: 'info', category: meta.category, message: meta.message, ruleId: meta.id, severity: meta.severity, fix: meta.fix, confidence: 0.6 });
      return results;
    }
    const startUrl = options.crawlStartUrl || `http://localhost:${options.port || 3000}`;
    // SSRF guard: when invoked from CI on untrusted code we must not let a
    // malicious config drive the headless browser at an arbitrary URL.
    // Allow loopback only by default; remote crawl requires the explicit
    // UBON_ALLOW_REMOTE_CRAWL=1 escape hatch (deliberately undocumented in
    // CLI help to keep the safe path obvious).
    try {
      const u = new URL(startUrl);
      const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
      if (!isLocal && process.env.UBON_ALLOW_REMOTE_CRAWL !== '1') {
        const meta = RULES.LINK001;
        results.push({
          type: 'info',
          category: meta.category,
          message: `Refusing to crawl non-loopback URL ${u.origin}. Set UBON_ALLOW_REMOTE_CRAWL=1 to override.`,
          ruleId: meta.id,
          severity: meta.severity,
          fix: 'Use a localhost dev server URL, or explicitly opt in with UBON_ALLOW_REMOTE_CRAWL=1.',
          confidence: 1.0,
        });
        return results;
      }
    } catch {
      return results;
    }
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


