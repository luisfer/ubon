import { isAllowedPackage } from '../rules/deps/allow.ts';
import { isPopularPackage, typosquatOf } from '../rules/deps/popular.ts';
import { type RegistryConfig, isPublicRegistry, readRegistryConfig } from '../rules/deps/registries.ts';
import { type ParsedSpec, isValidPackageName, parseInstallSpec } from '../rules/deps/spec.ts';
import { type SquatMatch, describeSquat } from '../rules/deps/squat.ts';
import type { PackageVerdict, PackageVetter, VetOptions } from '../rules/deps/verdict.ts';
import { DAY, HOUR, describeAge } from '../rules/deps/age.ts';
import { type FactCache, FileCache } from './cache.ts';
import { type HttpFetch, defaultFetch, hostLabel } from './http.ts';
import { type PackageFacts, type PackageQuery, lookUpPackages } from './lookup.ts';

/**
 * Package checks before an install: `ubon vet`, the package install check in
 * hooks, and the MCP `vet` tool. Offline it checks names against popular
 * packages and the allow list; online it adds existence, age, and
 * malicious-package lookups. Lookups that fail or run out of time leave the
 * verdict at `checked: 'offline'` with the reason, never a silent allow.
 */

export interface VetDependencies {
  fetch?: HttpFetch;
  cache?: FactCache;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Home directory for the user .npmrc; null to skip it. */
  home?: string | null;
  registries?: RegistryConfig;
}

export const DEFAULT_VET_TIMEOUT_MS = 15_000;

export const vetPackages: PackageVetter = (specs, options) => vetWith(specs, options);

export async function vetWith(specs: readonly string[], options: VetOptions, deps: VetDependencies = {}): Promise<PackageVerdict[]> {
  const now = deps.now ?? Date.now;
  const parsed = specs.map((s) => parseInstallSpec(s));
  const verdicts: Array<PackageVerdict | undefined> = [];
  const lookups: Array<{ index: number; query: PackageQuery; squat: SquatMatch | null }> = [];
  parsed.forEach((spec, index) => {
    const early = offlineVerdict(spec, options);
    if (early) {
      verdicts[index] = early;
      return;
    }
    const name = spec.name as string;
    lookups.push({
      index,
      squat: typosquatOf(name),
      query: { name, ...(spec.range ? { range: spec.range } : {}), packageAge: true, versionAge: true, malicious: true },
    });
  });

  let facts: PackageFacts[] = [];
  if (options.online && lookups.length > 0) {
    try {
      const registries = deps.registries ?? readRegistryConfig(options.root, { ...(deps.env ? { env: deps.env } : {}), ...(deps.home !== undefined ? { home: deps.home } : {}) });
      const cache = deps.cache ?? new FileCache();
      const timeoutMs = options.timeoutMs ?? DEFAULT_VET_TIMEOUT_MS;
      facts = await lookUpPackages(
        lookups.map((l) => l.query),
        { fetch: deps.fetch ?? defaultFetch, cache, registries, signal: AbortSignal.timeout(Math.max(1, timeoutMs)), isPopular: isPopularPackage },
      );
      cache.save();
    } catch (error) {
      // Hooks call this directly: an unexpected failure becomes a reason on each package, not an exception.
      const reason = `the lookup failed (${(error as Error)?.message ?? String(error)})`;
      facts = lookups.map((l) => ({ query: l.query, name: l.query.name, registry: 'https://registry.npmjs.org/', status: 'unchecked', reason }));
    }
  }

  lookups.forEach((l, i) => {
    const spec = parsed[l.index] as ParsedSpec;
    verdicts[l.index] = options.online ? onlineVerdict(spec, facts[i] as PackageFacts, l.squat, options, now()) : offlineRegistryVerdict(spec, l.squat);
  });
  return verdicts as PackageVerdict[];
}

function base(spec: ParsedSpec): Pick<PackageVerdict, 'spec' | 'name' | 'version'> {
  return { spec: spec.raw, name: spec.name ?? spec.location ?? spec.raw, ...(spec.range ? { version: spec.range } : {}) };
}

/** Verdicts that need no lookup: non-registry specs, invalid names, and allowed names. */
function offlineVerdict(spec: ParsedSpec, options: VetOptions): PackageVerdict | null {
  const b = base(spec);
  switch (spec.kind) {
    case 'git':
    case 'url':
      return {
        ...b,
        decision: 'ask',
        rule: 'deps/non-registry-source',
        reason: `${spec.raw} installs from ${spec.kind === 'git' ? 'a git repository' : 'a tarball URL'}, not the registry, so it skips registry checks and can change without a new version.`,
        checked: 'offline',
      };
    case 'file':
    case 'link':
    case 'workspace':
    case 'catalog':
      return { ...b, decision: 'allow', reason: `${spec.raw} is a local or workspace package, so there is nothing to look up.`, checked: 'offline' };
    case 'jsr':
      return { ...b, decision: 'allow', reason: `${spec.raw} is a JSR package; Ubon looks up npm packages only.`, checked: 'offline' };
    case 'other':
      return { ...b, decision: 'allow', reason: `${spec.raw} is not a registry package, so it was not looked up.`, checked: 'offline' };
    default:
      break;
  }
  const name = spec.name ?? '';
  if (!isValidPackageName(name)) {
    return { ...b, decision: 'deny', rule: 'deps/nonexistent-package', reason: `"${name}" is not a valid npm package name, so it cannot exist on the registry.`, checked: 'offline' };
  }
  if (isAllowedPackage(name, options.allow)) {
    return { ...b, decision: 'allow', reason: `${name} is on the packages.allow list in ubon.json, so it was not checked.`, checked: 'offline' };
  }
  return null;
}

function squatClause(squat: SquatMatch | null): string {
  return squat ? `${squat.name} ${describeSquat(squat)}` : '';
}

function offlineRegistryVerdict(spec: ParsedSpec, squat: SquatMatch | null): PackageVerdict {
  const b = base(spec);
  if (squat) {
    return { ...b, decision: 'ask', rule: 'deps/typosquat', reason: `${squatClause(squat)}; check that this is the package you meant (registry lookups are off).`, checked: 'offline' };
  }
  const name = spec.name as string;
  const known = isPopularPackage(name) ? `${name} is a popular package` : `${name} is not a lookalike of a popular package`;
  return { ...b, decision: 'allow', reason: `${known}; registry lookups are off, so existence, age, and malicious-package records were not checked.`, checked: 'offline' };
}

export function onlineVerdict(spec: ParsedSpec, facts: PackageFacts, squat: SquatMatch | null, options: VetOptions, now: number): PackageVerdict {
  const b = base(spec);
  const host = hostLabel(facts.registry);
  const name = facts.name;
  const at = facts.version ? `${name}@${facts.version}` : name;
  const also = squat ? `, and ${squatClause(squat)}` : '';
  const checked: PackageVerdict['checked'] = facts.status === 'unchecked' ? 'offline' : 'online';

  if (facts.malicious && facts.malicious.length > 0) {
    return { ...b, decision: 'deny', rule: 'deps/known-malicious', reason: `${at} has an OpenSSF malicious-package record in OSV (${facts.malicious.slice(0, 3).join(', ')}).`, checked };
  }
  if (facts.placeholder) {
    return { ...b, decision: 'deny', rule: 'deps/known-malicious', reason: `npm removed ${name} for malicious code and left a placeholder (0.0.1-security) in its place.`, checked };
  }
  if (facts.status === 'missing') {
    const what = facts.unpublished ? `${name} has no published versions on ${host} (they were unpublished)` : `${name} does not exist on ${host}`;
    return { ...b, decision: 'deny', rule: 'deps/nonexistent-package', reason: `${what}${squat ? `; ${squatClause(squat)}` : ''}.`, checked };
  }
  if (facts.status === 'unchecked') {
    if (squat) return { ...b, decision: 'ask', rule: 'deps/typosquat', reason: `${squatClause(squat)}; the registry lookup failed (${facts.reason ?? 'unknown error'}).`, checked };
    return { ...b, decision: 'allow', reason: `Not looked up: ${facts.reason ?? 'the registry lookup failed'}.`, checked };
  }
  if (facts.confusion) {
    return {
      ...b,
      decision: 'ask',
      rule: 'deps/nonexistent-package',
      reason: `${name} exists on ${host} but not on registry.npmjs.org, so anyone can publish a package with that name there (dependency confusion)${also}.`,
      checked,
    };
  }
  if (facts.created && now - Date.parse(facts.created) < options.minAgeDays * DAY) {
    return {
      ...b,
      decision: 'ask',
      rule: 'deps/young-package',
      reason: `${name} was first published ${describeAge(facts.created, now)} ago, and packages.minAgeDays is ${options.minAgeDays}${also}.`,
      checked,
    };
  }
  if (facts.versionTime && facts.version && now - Date.parse(facts.versionTime) < options.minReleaseAgeHours * HOUR) {
    return {
      ...b,
      decision: 'ask',
      rule: 'deps/young-package',
      reason: `${at} was published ${describeAge(facts.versionTime, now)} ago, and packages.minReleaseAgeHours is ${options.minReleaseAgeHours}${also}.`,
      checked,
    };
  }
  if (squat) return { ...b, decision: 'ask', rule: 'deps/typosquat', reason: `${squatClause(squat)}; check that this is the package you meant.`, checked };

  const parts: string[] = [];
  const published = facts.versionTime ? `, published ${facts.versionTime.slice(0, 10)}` : '';
  parts.push(`Found on ${host}${facts.version ? ` (${facts.version}${published})` : ''}`);
  const gaps: string[] = [];
  if (facts.reason) gaps.push(facts.reason);
  if (facts.osvReason) gaps.push(`malicious-package records not checked: ${facts.osvReason}`);
  else if (!isPublicRegistry(facts.registry)) gaps.push('OSV not queried for a package on a private registry');
  return { ...b, decision: 'allow', reason: `${parts.join('')}${gaps.length > 0 ? `; ${gaps.join('; ')}` : ''}.`, checked };
}
