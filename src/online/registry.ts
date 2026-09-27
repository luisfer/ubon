import { isRecord } from '../rules/deps/text.ts';
import { type HttpFetch, LookupError, hostLabel, requestJson, statusReason } from './http.ts';

/**
 * npm registry client. Requests carry the package name only.
 *
 * - GET <registry>/<name>/latest (about 1.5 KB): existence and latest version.
 * - GET <registry>/<name> with the abbreviated media type: dist-tags and
 *   versions, used when /latest is not enough (no latest tag, a dist-tag or
 *   range to resolve).
 * - GET <registry>/<name> in full: publish dates (`time`). It can be several
 *   megabytes for popular packages, so callers fetch it only when a date is
 *   needed and the search endpoint cannot give it.
 * - GET <registry>/-/v1/search?text=<name>: latest version, its publish date,
 *   and weekly downloads, on registries that support it (registry.npmjs.org
 *   does; api.npmjs.org, the downloads API, is not used because some networks
 *   block it).
 */

export interface RegistryRequest {
  fetch: HttpFetch;
  signal?: AbortSignal;
}

export interface LatestInfo {
  /** Version of the latest dist-tag. */
  version: string;
  deprecated?: string;
}

export interface Packument {
  distTags: Record<string, string>;
  versions: string[];
  /** Version to ISO publish date; only in the full document. */
  times: Record<string, string>;
  created?: string;
  /** Every version was unpublished. */
  unpublished: boolean;
}

export interface SearchInfo {
  version: string;
  date: string;
  weeklyDownloads?: number;
}

const ABBREVIATED = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8';

export function packageUrl(registry: string, name: string): string {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  return `${base}${encoded}`;
}

/**
 * The latest version, or null when the registry has no latest version for the
 * name (a 404: the package may not exist, or may have no latest tag). Other
 * HTTP errors and network failures throw LookupError.
 */
export async function fetchLatest(req: RegistryRequest, registry: string, name: string): Promise<LatestInfo | null | 'unsupported'> {
  const url = `${packageUrl(registry, name)}/latest`;
  const { status, data } = await requestJson(req.fetch, url, { signal: req.signal, maxBytes: 4 * 1024 * 1024 });
  if (status === 404) return null;
  // Registries without the /latest route answer 400, 405, or 406: use the document instead.
  if (status === 400 || status === 405 || status === 406) return 'unsupported';
  if (status !== 200) throw new LookupError('http', statusReason(hostLabel(url), status), status);
  if (!isRecord(data) || typeof data.version !== 'string') throw new LookupError('parse', `${hostLabel(url)} sent an unexpected answer for ${name}`);
  return { version: data.version, ...(typeof data.deprecated === 'string' ? { deprecated: data.deprecated } : {}) };
}

/** The package document (abbreviated or full), or null when the package does not exist (404). */
export async function fetchPackument(req: RegistryRequest, registry: string, name: string, full: boolean): Promise<Packument | null> {
  const url = packageUrl(registry, name);
  const { status, data } = await requestJson(req.fetch, url, {
    signal: req.signal,
    headers: { accept: full ? 'application/json' : ABBREVIATED },
    timeoutMs: full ? 30_000 : 15_000,
  });
  if (status === 404) return null;
  if (status !== 200) throw new LookupError('http', statusReason(hostLabel(url), status), status);
  if (!isRecord(data)) throw new LookupError('parse', `${hostLabel(url)} sent an unexpected answer for ${name}`);
  const distTags: Record<string, string> = {};
  if (isRecord(data['dist-tags'])) for (const [tag, v] of Object.entries(data['dist-tags'])) if (typeof v === 'string') distTags[tag] = v;
  const versions = isRecord(data.versions) ? Object.keys(data.versions) : [];
  const times: Record<string, string> = {};
  let created: string | undefined;
  let unpublished = false;
  if (isRecord(data.time)) {
    for (const [key, value] of Object.entries(data.time)) {
      if (key === 'created' && typeof value === 'string') created = value;
      else if (key === 'unpublished') unpublished = true;
      else if (key !== 'modified' && typeof value === 'string') times[key] = value;
    }
  }
  if (versions.length > 0) unpublished = false;
  return { distTags, versions, times, ...(created ? { created } : {}), unpublished };
}

/** Latest version, its date, and weekly downloads for an exact name, from the search endpoint; null when not listed. */
export async function searchExact(req: RegistryRequest, registry: string, name: string): Promise<SearchInfo | null> {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  const url = `${base}-/v1/search?text=${encodeURIComponent(name)}&size=5`;
  const { status, data } = await requestJson(req.fetch, url, { signal: req.signal, maxBytes: 2 * 1024 * 1024 });
  if (status !== 200 || !isRecord(data) || !Array.isArray(data.objects)) return null;
  for (const object of data.objects) {
    if (!isRecord(object) || !isRecord(object.package)) continue;
    const pkg = object.package;
    if (pkg.name !== name || typeof pkg.version !== 'string' || typeof pkg.date !== 'string') continue;
    const downloads = isRecord(object.downloads) && typeof object.downloads.weekly === 'number' ? object.downloads.weekly : undefined;
    return { version: pkg.version, date: pkg.date, ...(downloads !== undefined ? { weeklyDownloads: downloads } : {}) };
  }
  return null;
}
