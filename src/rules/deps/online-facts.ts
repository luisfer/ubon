import type { Project } from '../../core/project.ts';
import type { PackageFacts, PackageQuery } from '../../online/lookup.ts';
import type { ProjectContext } from '../types.ts';
import { isAllowedPackage } from './allow.ts';
import { depsDiff, lockedVersion, workspaceNames } from './changes.ts';
import { entryKey } from './lockfile.ts';
import { isValidPackageName } from './spec.ts';

/**
 * The packages that the online deps rules look up, and one shared lookup per
 * run: nonexistent-package, young-package, and known-malicious read the same
 * facts, so each name is requested once.
 */

export interface OnlineItem {
  /** File and line the finding goes on: the package.json entry, or the lockfile entry for transitive packages. */
  path: string;
  line: number;
  name: string;
  /** added: new in package.json; changed: a new version in package.json; transitive: new in a lockfile only. */
  kind: 'added' | 'changed' | 'transitive';
  query: PackageQuery;
  facts?: PackageFacts;
}

/** Total time for the lookups of one check. */
export const ONLINE_TIMEOUT_MS = 20_000;

const itemsMemo = new WeakMap<Project, OnlineItem[]>();
const runMemo = new WeakMap<Project, Promise<OnlineItem[]>>();

export function onlineItems(ctx: ProjectContext): OnlineItem[] {
  const cached = itemsMemo.get(ctx.project);
  if (cached) return cached;
  const diff = depsDiff(ctx);
  const allow = ctx.config.packages.allow;
  const local = workspaceNames(ctx.project);
  const items: OnlineItem[] = [];
  const covered = new Set<string>();
  const skip = (name: string) => !isValidPackageName(name) || local.has(name) || isAllowedPackage(name, allow);
  for (const m of diff.manifests) {
    for (const change of m.changes) {
      const spec = change.entry.spec;
      if ((spec.kind !== 'registry' && spec.kind !== 'alias') || !spec.name || skip(spec.name)) continue;
      const version = lockedVersion(diff, m.path, change.entry.name);
      const added = change.kind === 'added';
      items.push({
        path: m.path,
        line: change.entry.line,
        name: spec.name,
        kind: change.kind,
        query: {
          name: spec.name,
          ...(spec.range ? { range: spec.range } : {}),
          ...(version ? { version } : {}),
          packageAge: added,
          versionAge: true,
          malicious: true,
        },
      });
      covered.add(version ? `${spec.name}@${version}` : spec.name);
    }
  }
  for (const l of diff.lockfiles) {
    for (const e of l.added) {
      if (e.source !== 'registry' || !e.version || skip(e.name)) continue;
      if (covered.has(entryKey(e)) || covered.has(e.name)) continue;
      covered.add(entryKey(e));
      items.push({ path: l.path, line: e.line, name: e.name, kind: 'transitive', query: { name: e.name, version: e.version, registry: false, malicious: true } });
    }
  }
  itemsMemo.set(ctx.project, items);
  return items;
}

/** Look up every item once per run; later calls share the result. */
export function lookUpOnce(ctx: ProjectContext): Promise<OnlineItem[]> {
  const cached = runMemo.get(ctx.project);
  if (cached) return cached;
  const run = (async () => {
    const items = onlineItems(ctx);
    if (items.length === 0) return items;
    const [{ lookUpPackages }, { FileCache }, { defaultFetch }, { readRegistryConfig }, { isPopularPackage }] = await Promise.all([
      import('../../online/lookup.ts'),
      import('../../online/cache.ts'),
      import('../../online/http.ts'),
      import('./registries.ts'),
      import('./popular.ts'),
    ]);
    const cache = new FileCache();
    const facts = await lookUpPackages(
      items.map((i) => i.query),
      {
        fetch: defaultFetch,
        cache,
        registries: readRegistryConfig(ctx.project.root),
        signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
        isPopular: isPopularPackage,
      },
    );
    cache.save();
    return items.map((item, i) => ({ ...item, facts: facts[i] as PackageFacts }));
  })();
  runMemo.set(ctx.project, run);
  return run;
}

/** "2 packages (a, b)" for not-checked messages. */
export function describeGaps(names: readonly string[], reasons: readonly string[]): string {
  const unique = [...new Set(reasons)];
  const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')}, and ${names.length - 3} more`;
  return `${names.length} new package${names.length === 1 ? '' : 's'} (${list}): ${unique.slice(0, 2).join('; ')}`;
}
