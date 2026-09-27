import { type RegistryConfig, PUBLIC_REGISTRY, isPublicRegistry, registryFor } from '../rules/deps/registries.ts';
import { isRange, maxSatisfying, parseVersion, compareVersions, satisfies } from '../rules/deps/semver.ts';
import { isExactVersion } from '../rules/deps/spec.ts';
import { DAY, HOUR, MINUTE } from '../rules/deps/age.ts';
import type { FactCache } from './cache.ts';
import { type HttpFetch, LookupError, hostLabel, mapLimit } from './http.ts';
import { maliciousRecords } from './osv.ts';
import { type Packument, fetchLatest, fetchPackument, searchExact } from './registry.ts';

/**
 * Registry and OSV facts for a list of packages, shared by `ubon vet`, the
 * package install check in hooks, and the online deps rules. Every failure
 * becomes a reason on the package's facts instead of an exception, so a
 * caller can say exactly what was not checked.
 */

export interface PackageQuery {
  name: string;
  /** Version, range, or dist-tag as written; empty or undefined means latest. */
  range?: string;
  /** Exact version when it is already known (from a lockfile). */
  version?: string;
  /** Look the package up on the registry (default true). Off for lockfile entries that only need OSV. */
  registry?: boolean;
  /** Look up when the package was first published (new packages). */
  packageAge?: boolean;
  /** Look up when the version that would be installed was published. */
  versionAge?: boolean;
  /** Look for OpenSSF malicious-package records in OSV. */
  malicious?: boolean;
}

export interface PackageFacts {
  query: PackageQuery;
  name: string;
  /** Registry the package was looked up on. */
  registry: string;
  /** found: exists; missing: does not exist; unchecked: the lookup failed (see reason). */
  status: 'found' | 'missing' | 'unchecked';
  /** Why the lookup failed, or which part of it did not finish. */
  reason?: string;
  /** For missing packages that have a document: every version was unpublished. */
  unpublished?: boolean;
  latest?: string;
  /** The version that would be installed, when known. */
  version?: string;
  /** npm replaced the package with its security placeholder (0.0.1-security) after removing malware. */
  placeholder?: boolean;
  /** When the package was first published (ISO), if checked. */
  created?: string;
  /** When `version` was published (ISO), if checked. */
  versionTime?: string;
  weeklyDownloads?: number;
  /** MAL- record IDs; undefined when OSV was not checked (see osvReason). */
  malicious?: string[];
  osvReason?: string;
  /** Exists on the configured registry but not on registry.npmjs.org. */
  confusion?: boolean;
}

export interface LookupOptions {
  fetch: HttpFetch;
  cache: FactCache;
  registries: RegistryConfig;
  /** Overall deadline for every lookup. */
  signal?: AbortSignal;
  /** Popular packages skip the creation-date lookup (their documents are large and they are not new). */
  isPopular(name: string): boolean;
  concurrency?: number;
  osvApi?: string;
}

const PLACEHOLDER = '0.0.1-security';

interface LatestFact {
  /** Latest version, when the package exists. */
  v?: string;
  /** 'missing' or 'unpublished' when it does not. */
  m?: 'missing' | 'unpublished';
}

function describe(error: unknown, signal: AbortSignal | undefined): string {
  if (signal?.aborted) return 'the lookups did not finish within the time limit';
  if (error instanceof LookupError) return error.message;
  return `lookup failed (${(error as Error)?.message ?? String(error)})`;
}

async function latestFact(name: string, registry: string, options: LookupOptions): Promise<{ fact: LatestFact; packument?: Packument }> {
  const key = `latest|${registry}|${name}`;
  const cached = options.cache.get(key) as LatestFact | undefined;
  if (cached) return { fact: cached };
  const req = { fetch: options.fetch, signal: options.signal };
  const latest = await fetchLatest(req, registry, name);
  let fact: LatestFact;
  let packument: Packument | undefined;
  if (latest && latest !== 'unsupported') {
    fact = { v: latest.version };
  } else {
    // No latest version: confirm with the document, which also tells unpublished packages apart.
    const doc = await fetchPackument(req, registry, name, false);
    if (!doc) fact = { m: 'missing' };
    else if (doc.unpublished || doc.versions.length === 0) fact = { m: 'unpublished' };
    else {
      packument = doc;
      fact = { v: doc.distTags.latest ?? highest(doc.versions) };
    }
  }
  // Latest versions change: keep them briefly. A missing name can be registered: keep it for an hour.
  options.cache.set(key, fact, fact.v ? 10 * MINUTE : HOUR);
  return packument ? { fact, packument } : { fact };
}

function highest(versions: readonly string[]): string | undefined {
  let best: { text: string; parsed: NonNullable<ReturnType<typeof parseVersion>> } | undefined;
  for (const text of versions) {
    const parsed = parseVersion(text);
    if (!parsed || parsed.prerelease.length > 0) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { text, parsed };
  }
  return best?.text ?? versions[versions.length - 1];
}

async function registryFacts(query: PackageQuery, options: LookupOptions): Promise<PackageFacts> {
  const name = query.name;
  const registry = registryFor(options.registries, name);
  const facts: PackageFacts = { query, name, registry, status: 'unchecked' };
  if (query.registry === false) return facts;
  const req = { fetch: options.fetch, signal: options.signal };
  let packument: Packument | undefined;
  try {
    const result = await latestFact(name, registry, options);
    packument = result.packument;
    if (!result.fact.v) {
      facts.status = 'missing';
      if (result.fact.m === 'unpublished') facts.unpublished = true;
      return facts;
    }
    facts.status = 'found';
    facts.latest = result.fact.v;
  } catch (error) {
    facts.reason = describe(error, options.signal);
    return facts;
  }

  try {
    // The version that would be installed. npm prefers the latest tag when it satisfies the range.
    let version = query.version;
    if (!version) {
      const range = (query.range ?? '').trim();
      if (!range || range === 'latest' || range === '*' || range === 'x') version = facts.latest;
      else if (isExactVersion(range)) version = range.replace(/^v/, '');
      else if (!isRange(range)) {
        packument ??= (await fetchPackument(req, registry, name, false)) ?? undefined;
        version = packument?.distTags[range];
      } else if (facts.latest && satisfies(facts.latest, range)) version = facts.latest;
      else {
        packument ??= (await fetchPackument(req, registry, name, false)) ?? undefined;
        version = packument ? maxSatisfying(packument.versions, range) ?? undefined : undefined;
      }
    }
    if (version) facts.version = version;
    // npm replaces every version of a removed malicious package with this one.
    if (version === PLACEHOLDER || facts.latest === PLACEHOLDER) facts.placeholder = true;

    const needCreated = !!query.packageAge && !options.isPopular(name);
    const needTime = !!query.versionAge && !!version && version !== PLACEHOLDER;
    let created = needCreated ? (options.cache.get(`created|${registry}|${name}`) as string | undefined) : undefined;
    let versionTime = needTime ? (options.cache.get(`time|${registry}|${name}@${version}`) as string | undefined) : undefined;
    // The search endpoint gives the latest version's date without the full document.
    if (needTime && !versionTime && !needCreated && version === facts.latest && isPublicRegistry(registry)) {
      try {
        const hit = await searchExact(req, registry, name);
        if (hit && hit.version === version) {
          versionTime = hit.date;
          if (hit.weeklyDownloads !== undefined) facts.weeklyDownloads = hit.weeklyDownloads;
        }
      } catch {
        // fall back to the full document
      }
    }
    if ((needCreated && !created) || (needTime && !versionTime)) {
      const full = await fetchPackument(req, registry, name, true);
      if (full) {
        created = full.created ?? created;
        if (version && full.times[version]) versionTime = full.times[version];
      }
    }
    if (created) {
      facts.created = created;
      options.cache.set(`created|${registry}|${name}`, created, DAY);
    }
    if (versionTime && version) {
      facts.versionTime = versionTime;
      options.cache.set(`time|${registry}|${name}@${version}`, versionTime, DAY);
    }
    if ((needCreated && !created) || (needTime && !versionTime)) facts.reason = `${hostLabel(registry)} did not list a publish date`;
  } catch (error) {
    facts.reason = `publish dates not checked: ${describe(error, options.signal)}`;
  }

  // Dependency confusion: an unscoped name found on a private default registry that nobody owns on npm.
  if (facts.status === 'found' && !name.startsWith('@') && !isPublicRegistry(registry)) {
    try {
      const pub = await latestFact(name, PUBLIC_REGISTRY, options);
      if (!pub.fact.v) facts.confusion = true;
    } catch {
      // unknown; the name stays unreported
    }
  }
  return facts;
}

export async function lookUpPackages(queries: readonly PackageQuery[], options: LookupOptions): Promise<PackageFacts[]> {
  const facts = await mapLimit(queries, options.concurrency ?? 6, (q) => registryFacts(q, options));

  // OSV, in one batch, for public npm packages only (private names are never sent anywhere else).
  const pending: Array<{ facts: PackageFacts; version?: string; key: string }> = [];
  for (const f of facts) {
    if (!f.query.malicious || f.status === 'missing' || !isPublicRegistry(f.registry)) continue;
    const version = f.version ?? f.query.version;
    const key = `osv|${f.name}@${version ?? '*'}`;
    const cached = options.cache.get(key) as string[] | undefined;
    if (cached) f.malicious = cached;
    else pending.push({ facts: f, ...(version ? { version } : {}), key });
  }
  if (pending.length > 0) {
    try {
      const results = await maliciousRecords(
        { fetch: options.fetch, signal: options.signal, ...(options.osvApi ? { api: options.osvApi } : {}) },
        pending.map((p) => ({ name: p.facts.name, ...(p.version ? { version: p.version } : {}) })),
      );
      pending.forEach((p, i) => {
        const ids = results[i] ?? [];
        p.facts.malicious = ids;
        // New records appear within hours of a compromise: keep clean results briefly.
        options.cache.set(p.key, ids, ids.length > 0 ? DAY : HOUR);
      });
    } catch (error) {
      const reason = describe(error, options.signal);
      for (const p of pending) p.facts.osvReason = reason;
    }
  }
  return facts;
}

