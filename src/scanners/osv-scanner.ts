import { Scanner, ScanResult, ScanOptions } from '../types';
import { readFileSync, existsSync } from 'fs';
import https from 'https';
import { FileCache, createOSVCacheKey, CACHE_TTL } from '../utils/cache';

function postJson(url: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const { hostname, pathname } = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request({ hostname, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
        } else {
          reject(new Error(`OSV ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export class OSVScanner implements Scanner {
  name = 'Dependency Advisory Scanner';
  private cache = new FileCache<any>('osv');

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    // Clear cache if requested
    if (options.clearCache) {
      this.cache.clear();
    }
    const npmPath = `${options.directory}/package.json`;
    const pyPath = `${options.directory}/requirements.txt`;

    const npmDeps: { name: string; version: string }[] = [];
    if (existsSync(npmPath)) {
      try {
        const pkg = JSON.parse(readFileSync(npmPath, 'utf-8'));
        const all = { ...(pkg.dependencies||{}), ...(pkg.devDependencies||{}) };
        for (const [name, ver] of Object.entries(all)) {
          const clean = String(ver).replace(/^[^0-9]*/, '');
          if (clean) npmDeps.push({ name, version: clean });
        }
      } catch {}
    }

    const pyDeps: { name: string; version?: string }[] = [];
    if (existsSync(pyPath)) {
      try {
        const text = readFileSync(pyPath, 'utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [nameVer] = trimmed.split(/\s+/);
          const [name, version] = nameVer.split('==');
          if (name) pyDeps.push({ name, version });
        }
      } catch {}
    }

    const queries: any[] = [];
    for (const d of npmDeps) {
      queries.push({ package: { ecosystem: 'npm', name: d.name }, version: d.version });
    }
    for (const d of pyDeps) {
      queries.push({ package: { ecosystem: 'PyPI', name: d.name }, version: d.version });
    }
    if (queries.length === 0) return results;

    // Create cache key for this set of queries
    const cacheKey = createOSVCacheKey(queries);
    
    // Try to get cached results first (unless caching is disabled)
    let data = options.noCache ? null : this.cache.get(cacheKey);
    
    if (!data) {
      // No cached data, make API call
      try {
        data = await postJson('https://api.osv.dev/v1/querybatch', { queries });
        // Cache the results for 24 hours (unless caching is disabled)
        if (!options.noCache) {
          this.cache.set(cacheKey, data, CACHE_TTL.OSV_VULNERABILITIES);
        }
      } catch (error) {
        // API call failed, return empty results
        return results;
      }
    }

    try {
      const vulns = data.results || [];
      vulns.forEach((entry: any, idx: number) => {
        const q = queries[idx];
        const pkgName = q.package.name;
        const eco = q.package.ecosystem;
        if (entry.vulns && entry.vulns.length) {
          for (const v of entry.vulns) {
            results.push({
              type: 'error',
              category: 'security',
              message: `Vulnerability in ${eco}:${pkgName} (${v.id || v.aliases?.[0] || 'UNKNOWN'})`,
              severity: 'high',
              ruleId: 'OSV001',
              fix: v.summary || 'Update to a patched version',
              confidence: 0.9
            });
          }
        }
      });
    } catch {}

    return results;
  }
}
