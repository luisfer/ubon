import type { Rule } from '../types.ts';
import { isAllowedPackage } from './allow.ts';
import { depsDiff, workspaceNames } from './changes.ts';
import { typosquatOf } from './popular.ts';
import { describeSquat } from './squat.ts';

/**
 * A dependency added to package.json whose name imitates a popular package.
 * Offline: the popular names are bundled (src/data/popular-packages.ts). The
 * package install check in hooks calls typosquatOf() through vetPackages.
 */
export const typosquat: Rule = {
  meta: {
    id: 'deps/typosquat',
    level: 'warn',
    scope: 'diff',
    title: 'New dependency named like a popular package',
    summary:
      'A dependency added to package.json whose name is one edit away from a popular npm package or follows a known lookalike pattern of one: scope dropped, separators changed, a js prefix or suffix, a letter doubled or dropped, or lookalike characters such as rn for m.',
    why: 'Typosquatted packages copy a popular name with a small change and run malware when installed. Agents also misremember package names, and attackers register the misspellings they produce.',
    fix: 'Use the name of the package you meant; if this name is intended, add it to packages.allow in ubon.json.',
    cwe: ['CWE-1357'],
    owasp: ['A03:2025'],
    levels: 'The package install check in hooks returns "ask" for the same match, so a person confirms the name.',
  },
  project(ctx) {
    const diff = depsDiff(ctx);
    if (diff.manifests.length === 0) return;
    const local = workspaceNames(ctx.project);
    for (const m of diff.manifests) {
      for (const change of m.changes) {
        if (change.kind !== 'added') continue;
        const spec = change.entry.spec;
        if ((spec.kind !== 'registry' && spec.kind !== 'alias') || !spec.name) continue;
        const name = spec.name;
        if (local.has(name) || isAllowedPackage(name, ctx.config.packages.allow)) continue;
        const match = typosquatOf(name);
        if (!match) continue;
        const installedAs = spec.alias ? ` (installed as ${spec.alias})` : '';
        ctx.report(m.path, {
          line: change.entry.line,
          message: `New dependency ${name}${installedAs} ${describeSquat(match)}.`,
          fix: `If you meant ${match.target}, use that name; if ${name} is intended, add it to packages.allow in ubon.json.`,
          key: name,
        });
      }
    }
  },
};
