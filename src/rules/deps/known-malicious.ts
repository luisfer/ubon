import type { Rule } from '../types.ts';
import { isAllowedPackage } from './allow.ts';
import { depsDiff } from './changes.ts';
import type { OnlineFinding } from './nonexistent-package.ts';
import { type OnlineItem, describeGaps, lookUpOnce, onlineItems } from './online-facts.ts';

/**
 * A package or version added in this change (in package.json, or only in the
 * lockfile) that has an OpenSSF malicious-package record in OSV (MAL- IDs,
 * online), or that npm replaced with its security placeholder after removing
 * malware (0.0.1-security, also visible offline in package.json and lockfiles).
 */

const PLACEHOLDER = '0.0.1-security';

function placeholderMessage(name: string): string {
  return `npm removed ${name} for malicious code, and ${name}@${PLACEHOLDER} is the empty placeholder it left.`;
}

export function maliciousFindings(items: readonly OnlineItem[]): { findings: OnlineFinding[]; gaps: string[] } {
  const findings: OnlineFinding[] = [];
  const missed: string[] = [];
  const reasons: string[] = [];
  for (const item of items) {
    const f = item.facts;
    if (!f) continue;
    const version = f.version ?? item.query.version;
    const at = version ? `${item.name}@${version}` : item.name;
    const label = item.kind === 'added' ? `New dependency ${at}` : item.kind === 'changed' ? `Dependency ${at}` : `New package ${at} (a dependency of another package)`;
    if (f.malicious && f.malicious.length > 0) {
      findings.push({
        path: item.path,
        line: item.line,
        message: `${label} has an OpenSSF malicious-package record in OSV (${f.malicious.slice(0, 3).join(', ')}).`,
        key: at,
      });
    } else if (f.placeholder) {
      findings.push({ path: item.path, line: item.line, message: placeholderMessage(item.name), key: `${item.name}@${PLACEHOLDER}` });
    } else if (f.osvReason && f.status !== 'missing') {
      missed.push(at);
      reasons.push(f.osvReason);
    }
  }
  return { findings, gaps: missed.length > 0 ? [describeGaps(missed, reasons)] : [] };
}

export const knownMalicious: Rule = {
  meta: {
    id: 'deps/known-malicious',
    level: 'block',
    scope: 'diff',
    title: 'New package with a malicious-package record',
    summary:
      'A package or version added in this change, directly or through the lockfile, that has an OpenSSF malicious-package record in OSV (IDs that start with MAL-, looked up with --online, packages.online, or `ubon vet`), or that npm replaced with its 0.0.1-security placeholder (checked offline too).',
    why: 'These records are confirmed by people: the package or version ran malware, usually when installed. Installing it again, even to test, runs it again.',
    fix: 'Remove the package, and if it was installed, treat the machine and the credentials it holds as exposed.',
    cwe: ['CWE-506', 'CWE-829'],
    owasp: ['A03:2025'],
    levels: 'OSV lookups run only when lookups are allowed, and only packages from the public npm registry are sent, by name and version.',
  },
  // Offline: npm's placeholder version pinned in package.json or a lockfile.
  project(ctx) {
    const diff = depsDiff(ctx);
    const allow = ctx.config.packages.allow;
    const reported = new Set<string>();
    for (const m of diff.manifests) {
      for (const change of m.changes) {
        const spec = change.entry.spec;
        if ((spec.kind !== 'registry' && spec.kind !== 'alias') || !spec.name || spec.range?.trim() !== PLACEHOLDER) continue;
        if (isAllowedPackage(spec.name, allow)) continue;
        reported.add(spec.name);
        ctx.report(m.path, { line: change.entry.line, message: placeholderMessage(spec.name), key: `${spec.name}@${PLACEHOLDER}` });
      }
    }
    for (const l of diff.lockfiles) {
      for (const e of l.added) {
        if (e.version !== PLACEHOLDER || reported.has(e.name) || isAllowedPackage(e.name, allow)) continue;
        reported.add(e.name);
        ctx.report(l.path, { line: e.line, message: placeholderMessage(e.name), key: `${e.name}@${PLACEHOLDER}` });
      }
    }
  },
  needsOnline: (ctx) => onlineItems(ctx).length > 0,
  async online(ctx) {
    const items = await lookUpOnce(ctx);
    const { findings, gaps } = maliciousFindings(items);
    for (const f of findings) ctx.report(f.path, { line: f.line, message: f.message, key: f.key });
    if (gaps.length > 0) throw new Error(`OSV not checked: ${gaps.join('; ')}`);
  },
};
