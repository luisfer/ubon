import type { UbonConfig } from '../../core/config.ts';
import { DAY, HOUR, describeAge } from './age.ts';
import type { Rule } from '../types.ts';
import type { OnlineFinding } from './nonexistent-package.ts';
import { type OnlineItem, describeGaps, lookUpOnce, onlineItems } from './online-facts.ts';

/**
 * A new package first published less than packages.minAgeDays ago, or a new
 * version published less than packages.minReleaseAgeHours ago. Most malicious
 * versions in 2025 and 2026 were caught within hours or days of publication,
 * so a short cooldown blocks most of them.
 */

export function youngFindings(items: readonly OnlineItem[], packages: UbonConfig['packages'], now: number): { findings: OnlineFinding[]; gaps: string[] } {
  const findings: OnlineFinding[] = [];
  const missed: string[] = [];
  const reasons: string[] = [];
  for (const item of items) {
    const f = item.facts;
    if (item.kind === 'transitive' || !f) continue;
    if (f.status === 'unchecked') {
      if (f.reason) {
        missed.push(item.name);
        reasons.push(f.reason);
      }
      continue;
    }
    if (f.status !== 'found' || f.placeholder) continue;
    const label = item.kind === 'added' ? `New dependency ${item.name}` : item.name;
    if (item.kind === 'added' && f.created && now - Date.parse(f.created) < packages.minAgeDays * DAY) {
      findings.push({
        path: item.path,
        line: item.line,
        message: `${label} was first published ${describeAge(f.created, now)} ago, and packages.minAgeDays is ${packages.minAgeDays}.`,
        key: item.name,
      });
      continue;
    }
    if (f.version && f.versionTime && now - Date.parse(f.versionTime) < packages.minReleaseAgeHours * HOUR) {
      findings.push({
        path: item.path,
        line: item.line,
        message: `${item.kind === 'added' ? `New dependency ${item.name}` : `Dependency ${item.name}`} resolves to ${f.version}, published ${describeAge(f.versionTime, now)} ago, and packages.minReleaseAgeHours is ${packages.minReleaseAgeHours}.`,
        key: `${item.name}@${f.version}`,
      });
      continue;
    }
    if (f.reason) {
      missed.push(item.name);
      reasons.push(f.reason);
    }
  }
  return { findings, gaps: missed.length > 0 ? [describeGaps(missed, reasons)] : [] };
}

export const youngPackage: Rule = {
  meta: {
    id: 'deps/young-package',
    level: 'block',
    scope: 'diff',
    title: 'New dependency or version published too recently',
    summary:
      'A package added to package.json that was first published less than packages.minAgeDays ago (default 7), or a new dependency version published less than packages.minReleaseAgeHours ago (default 48). Looked up with --online, packages.online, or `ubon vet`.',
    why: 'Most malicious packages and hijacked versions are found and removed within hours or days of publication. A short cooldown keeps them out of the project while that happens.',
    fix: 'Pin a version published before the cooldown, or wait; a person can add the package to packages.allow in ubon.json.',
    cwe: ['CWE-1357', 'CWE-829'],
    owasp: ['A03:2025'],
    levels: 'The package install check in hooks returns "ask" instead of blocking, so a person decides. Names and scopes on packages.allow are not checked.',
  },
  needsOnline: (ctx) => onlineItems(ctx).some((i) => i.kind !== 'transitive'),
  async online(ctx) {
    const items = await lookUpOnce(ctx);
    const { findings, gaps } = youngFindings(items, ctx.config.packages, Date.now());
    for (const f of findings) ctx.report(f.path, { line: f.line, message: f.message, key: f.key });
    if (gaps.length > 0) throw new Error(`publish dates not checked: ${gaps.join('; ')}`);
  },
};
