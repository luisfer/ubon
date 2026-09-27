import type { Level } from '../../core/types.ts';
import type { Rule } from '../types.ts';
import { depsDiff } from './changes.ts';
import { type OnlineItem, describeGaps, lookUpOnce, onlineItems } from './online-facts.ts';
import { typosquatOf } from './popular.ts';
import { isValidPackageName } from './spec.ts';
import { describeSquat } from './squat.ts';

/**
 * A dependency added to package.json that does not exist on the registry it
 * resolves to (--online, packages.online, or ubon vet). Scoped packages that
 * .npmrc maps to another registry are looked up there, never on the public
 * registry. Offline, names that npm would refuse are reported.
 */

export interface OnlineFinding {
  path: string;
  line: number;
  message: string;
  level?: Level;
  fix?: string;
  key: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function nonexistentFindings(items: readonly OnlineItem[]): { findings: OnlineFinding[]; gaps: string[] } {
  const findings: OnlineFinding[] = [];
  const missed: string[] = [];
  const reasons: string[] = [];
  for (const item of items) {
    const f = item.facts;
    if (item.kind !== 'added' || !f) continue;
    const host = hostOf(f.registry);
    if (f.status === 'missing') {
      const squat = typosquatOf(item.name);
      const what = f.unpublished ? `has no published versions on ${host} (they were unpublished)` : `does not exist on ${host}`;
      findings.push({
        path: item.path,
        line: item.line,
        message: `New dependency ${item.name} ${what}${squat ? `; it ${describeSquat(squat)}` : ''}.`,
        fix: `Remove it or correct the name${squat ? ` (${squat.target}?)` : ''}, and check the package with \`ubon vet\` before adding it; anyone can register an unused name.`,
        key: item.name,
      });
    } else if (f.confusion) {
      findings.push({
        path: item.path,
        line: item.line,
        level: 'warn',
        message: `New dependency ${item.name} exists on ${host} but not on registry.npmjs.org, so anyone can publish a package with that name there.`,
        fix: `Register the name on npm, or move the package under a scope that .npmrc maps to ${host}.`,
        key: item.name,
      });
    } else if (f.status === 'unchecked' && f.reason) {
      missed.push(item.name);
      reasons.push(f.reason);
    }
  }
  return { findings, gaps: missed.length > 0 ? [describeGaps(missed, reasons)] : [] };
}

export const nonexistentPackage: Rule = {
  meta: {
    id: 'deps/nonexistent-package',
    level: 'block',
    scope: 'diff',
    title: 'New dependency that does not exist on the registry',
    summary:
      'A package added to package.json that does not exist on the registry it resolves to, looked up with --online, packages.online, or `ubon vet`, or whose name is not a valid npm package name (checked offline); also an unscoped name that exists on a private registry but not on npm.',
    why: 'Models invent plausible package names, and attackers register the names they invent (slopsquatting). A name nobody owns yet can be published by anyone before the next install.',
    fix: 'Remove the dependency or correct its name, and check the package with `ubon vet <name>` before adding it.',
    cwe: ['CWE-1357', 'CWE-829'],
    owasp: ['A03:2025'],
    levels:
      'warn for an unscoped package that exists on the private registry in .npmrc but not on registry.npmjs.org (dependency confusion). Runs only when lookups are allowed; scoped packages that .npmrc maps to another registry are looked up there or skipped, never sent to the public registry.',
  },
  // Offline: a name npm would refuse cannot exist on any registry.
  project(ctx) {
    for (const m of depsDiff(ctx).manifests) {
      for (const change of m.changes) {
        const spec = change.entry.spec;
        if (change.kind !== 'added' || (spec.kind !== 'registry' && spec.kind !== 'alias') || spec.name === undefined) continue;
        if (isValidPackageName(spec.name)) continue;
        ctx.report(m.path, {
          line: change.entry.line,
          message: `New dependency ${JSON.stringify(spec.name)} is not a valid npm package name, so no registry can have it.`,
          fix: 'Correct the name (lowercase letters, digits, and - . _ only, with an optional @scope/), or remove the dependency.',
          key: spec.name,
        });
      }
    }
  },
  needsOnline: (ctx) => onlineItems(ctx).some((i) => i.kind === 'added'),
  async online(ctx) {
    const items = await lookUpOnce(ctx);
    const { findings, gaps } = nonexistentFindings(items);
    for (const f of findings) ctx.report(f.path, { line: f.line, message: f.message, key: f.key, ...(f.level ? { level: f.level } : {}), ...(f.fix ? { fix: f.fix } : {}) });
    if (gaps.length > 0) throw new Error(`not looked up: ${gaps.join('; ')}`);
  },
};
