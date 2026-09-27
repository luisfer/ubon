import { posix } from 'node:path';
import type { Rule } from '../types.ts';
import { isAllowedPackage } from './allow.ts';
import { depsDiff } from './changes.ts';
import { type LockEntry, entryKey } from './lockfile.ts';
import { hostOf, readRegistryConfig } from './registries.ts';
import { type ParsedSpec, parseDependencySpec } from './spec.ts';

/**
 * Dependencies added in this change that do not come from a registry: git
 * repositories, tarball URLs, local paths outside the repository, and lockfile
 * entries downloaded from hosts that are not a configured registry.
 */

/** Hide credentials in URLs (user:password@, token@) before they reach a message; git@ stays. */
export function redactUrl(text: string): string {
  return text.replace(/(\/\/)([^/@\s]+)@/g, (whole, slashes: string, user: string) => (user.includes(':') || user.length > 20 ? `${slashes}***@` : whole));
}

const FIXES: Record<string, string> = {
  git: 'Install it from the registry, or pin the git dependency to a full commit hash and review the code at that commit.',
  url: 'Install it from the registry, or check the tarball and pin it with an integrity hash.',
  file: 'Move the package into the repository as a workspace package, or publish it to your registry.',
  host: 'Regenerate the lockfile with your package manager; if that host is a registry you use, configure it in .npmrc.',
  exec: 'Build the package in a script you control, or install it from the registry.',
};

function fixFor(what: string): string {
  if (what.startsWith('a git repository')) return FIXES.git as string;
  if (what.startsWith('a tarball URL')) return FIXES.url as string;
  if (what.startsWith('a local path')) return FIXES.file as string;
  if (what.startsWith('a script')) return FIXES.exec as string;
  return FIXES.host as string;
}

function short(text: string): string {
  const clean = redactUrl(text);
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

/** True when a local path, relative to `fromDir` in the repository, leaves the repository. */
function outsideRepository(location: string, fromDir: string): boolean {
  const path = location.replace(/^file:/, '').replace(/\\/g, '/');
  if (path.startsWith('/') || path.startsWith('~') || /^[a-z]:\//i.test(path)) return true;
  const joined = posix.normalize(posix.join(fromDir || '.', path));
  return joined === '..' || joined.startsWith('../');
}

function describeManifestSource(spec: ParsedSpec, manifestDir: string): string | null {
  const where = spec.location ?? spec.raw;
  switch (spec.kind) {
    case 'git':
      return `a git repository (${short(where)})`;
    case 'url':
      return `a tarball URL (${short(where)})`;
    case 'file':
    case 'link':
      return outsideRepository(where, manifestDir) ? `a local path outside the repository (${short(spec.raw)})` : null;
    case 'other':
      return /^exec:/i.test(spec.raw) ? `a script that builds it (${short(spec.raw)})` : null;
    default:
      return null;
  }
}

function describeLockSource(e: LockEntry, lockDir: string, hosts: ReadonlySet<string>): string | null {
  const where = e.resolved ?? '';
  switch (e.source) {
    case 'git':
      return `a git repository (${short(where)})`;
    case 'url': {
      const host = hostOf(where);
      return host && hosts.has(host) ? null : `a tarball URL (${short(where)})`;
    }
    case 'file':
      return outsideRepository(where, lockDir) ? `a local path outside the repository (${short(where)})` : null;
    case 'registry': {
      if (!/^https?:\/\//i.test(where)) return null;
      const host = hostOf(where);
      return host && !hosts.has(host) ? `${host}, which is not a configured registry` : null;
    }
    case 'other':
      return /^exec:/i.test(where) ? `a script that builds it (${short(where)})` : null;
    default:
      return null;
  }
}

export const nonRegistrySource: Rule = {
  meta: {
    id: 'deps/non-registry-source',
    level: 'warn',
    scope: 'diff',
    title: 'New dependency from outside the registry',
    summary:
      'A dependency added in this change that comes from a git repository (git+, github:), a tarball URL, or a file: path outside the repository, or a new lockfile entry downloaded from a host that is not a configured registry.',
    why: 'These sources skip the registry and its checks: there is no immutable version, no publish date, and no malicious-package record to look up, and a branch or URL can serve different code tomorrow. A changed resolved URL in a lockfile is also how lockfile injection works.',
    fix: 'Install the package from the registry, or pin it to a full commit hash or an integrity-checked tarball and review the code.',
    cwe: ['CWE-829', 'CWE-494'],
    owasp: ['A03:2025'],
    levels: 'workspace:, catalog:, link:, and file: paths inside the repository are fine. Hosts from .npmrc, .yarnrc.yml, and .yarnrc count as configured registries.',
  },
  project(ctx) {
    const diff = depsDiff(ctx);
    if (diff.manifests.length === 0 && diff.lockfiles.length === 0) return;
    const allow = ctx.config.packages.allow;
    const reported = new Set<string>();
    for (const m of diff.manifests) {
      const dir = posix.dirname(m.path) === '.' ? '' : posix.dirname(m.path);
      for (const change of m.changes) {
        const name = change.entry.name;
        if (isAllowedPackage(name, allow)) continue;
        const what = describeManifestSource(change.entry.spec, dir);
        if (!what) continue;
        // A dependency that already came from this kind of source (moved to another ref) was trusted at the base.
        if (change.kind === 'changed' && change.before !== undefined && parseDependencySpec(name, change.before).kind === change.entry.spec.kind) continue;
        reported.add(name);
        ctx.report(m.path, {
          line: change.entry.line,
          message: `${change.kind === 'added' ? 'New dependency' : 'Dependency'} ${name} ${change.kind === 'added' ? 'comes' : 'now comes'} from ${what} instead of the registry.`,
          fix: fixFor(what),
          key: name,
        });
      }
    }
    if (diff.lockfiles.length === 0) return;
    const hosts = readRegistryConfig(ctx.project.root).hosts;
    for (const l of diff.lockfiles) {
      const dir = posix.dirname(l.path) === '.' ? '' : posix.dirname(l.path);
      const file = l.path.slice(l.path.lastIndexOf('/') + 1);
      for (const e of l.added) {
        if (reported.has(e.name) || isAllowedPackage(e.name, allow)) continue;
        const what = describeLockSource(e, dir, hosts);
        if (!what) continue;
        // A package that already came from the same kind of source at the base is not new.
        const before = diff.baseSources.get(e.name);
        if (before && e.source !== 'registry' && before.has(e.source)) continue;
        const version = e.version && /^\d/.test(e.version) ? `@${e.version}` : '';
        const verb = e.source === 'registry' ? 'is downloaded from' : 'comes from';
        ctx.report(l.path, {
          line: e.line,
          message: `New package ${e.name}${version} in ${file} ${verb} ${what}${e.source === 'registry' ? '' : ' instead of the registry'}.`,
          fix: fixFor(what),
          key: entryKey(e),
        });
      }
    }
  },
};
