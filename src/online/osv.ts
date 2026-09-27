import { isRecord } from '../rules/deps/text.ts';
import { type HttpFetch, LookupError, requestJson, statusReason } from './http.ts';

/**
 * OSV lookups for npm packages. Only OpenSSF malicious-package records
 * (IDs that start with MAL-) are used: they are confirmed by people, while
 * vulnerability advisories are the job of npm audit and osv-scanner.
 * Requests carry package names and versions only, and only for packages on
 * the public npm registry.
 */

export const OSV_API = 'https://api.osv.dev/v1';
const BATCH_LIMIT = 1000;

export interface OsvQuery {
  name: string;
  /** Exact version. Without one, only records that cover every version count. */
  version?: string;
}

export interface OsvRequest {
  fetch: HttpFetch;
  signal?: AbortSignal;
  api?: string;
}

/** MAL- record IDs per query, in query order. Throws LookupError when OSV cannot be reached. */
export async function maliciousRecords(req: OsvRequest, queries: readonly OsvQuery[]): Promise<string[][]> {
  const api = req.api ?? OSV_API;
  const out: string[][] = [];
  for (let start = 0; start < queries.length; start += BATCH_LIMIT) {
    const chunk = queries.slice(start, start + BATCH_LIMIT);
    const body = JSON.stringify({
      queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: 'npm' }, ...(q.version ? { version: q.version } : {}) })),
    });
    const { status, data } = await requestJson(req.fetch, `${api}/querybatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: req.signal,
      timeoutMs: 15_000,
    });
    if (status !== 200) throw new LookupError('http', statusReason(hostOf(api), status), status);
    if (!isRecord(data) || !Array.isArray(data.results)) throw new LookupError('parse', `${hostOf(api)} sent an unexpected answer`);
    for (let i = 0; i < chunk.length; i++) {
      const result = data.results[i];
      const vulns = isRecord(result) && Array.isArray(result.vulns) ? result.vulns : [];
      out.push(vulns.map((v) => (isRecord(v) && typeof v.id === 'string' ? v.id : '')).filter((id) => id.startsWith('MAL-')));
    }
  }
  // Without a version, a record counts only when it covers every version of the package.
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i] as OsvQuery;
    const ids = out[i] as string[];
    if (q.version || ids.length === 0) continue;
    const kept: string[] = [];
    for (const id of ids) {
      const { status, data } = await requestJson(req.fetch, `${api}/vulns/${encodeURIComponent(id)}`, { signal: req.signal, timeoutMs: 10_000 });
      if (status !== 200) throw new LookupError('http', statusReason(hostOf(api), status), status);
      if (coversAllVersions(data, q.name)) kept.push(id);
    }
    out[i] = kept;
  }
  return out;
}

/** True when an OSV record marks every version of the npm package as affected (introduced 0, never fixed). */
export function coversAllVersions(record: unknown, name: string): boolean {
  if (!isRecord(record) || !Array.isArray(record.affected)) return false;
  for (const affected of record.affected) {
    if (!isRecord(affected) || !isRecord(affected.package)) continue;
    if (affected.package.ecosystem !== 'npm' || affected.package.name !== name) continue;
    if (!Array.isArray(affected.ranges)) continue;
    for (const range of affected.ranges) {
      if (!isRecord(range) || !Array.isArray(range.events)) continue;
      const events = range.events.filter(isRecord);
      const open = events.some((e) => e.introduced === '0') && !events.some((e) => 'fixed' in e || 'last_affected' in e || 'limit' in e);
      if (open) return true;
    }
  }
  return false;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
