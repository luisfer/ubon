import type { ProjectContext, Rule } from '../types.ts';
import { isAllowedPackage } from './allow.ts';
import { depsDiff } from './changes.ts';
import { entryKey } from './lockfile.ts';
import { isRecord, yamlStringList } from './text.ts';

/**
 * A package that is new in the lockfile (direct or transitive) and runs an
 * install script: hasInstallScript in package-lock.json, requiresBuild in
 * pnpm-lock.yaml (lockfile v5 and v6; pnpm 9 lockfiles no longer record it,
 * and pnpm 10 runs no dependency scripts unless they are allowed).
 */

function projectIgnoresScripts(ctx: ProjectContext): boolean {
  const npmrc = ctx.project.read('.npmrc');
  return npmrc !== null && /^\s*ignore-scripts\s*=\s*true\s*$/m.test(npmrc);
}

/** pnpm settings that decide which dependencies may run build scripts. */
function pnpmBuildPolicy(ctx: ProjectContext): { only: Set<string> | null; never: Set<string> } {
  const names = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null);
  let only: string[] | null = null;
  const never: string[] = [];
  const root = ctx.project.rootPackage()?.raw;
  if (root && isRecord(root.pnpm)) {
    only = names(root.pnpm.onlyBuiltDependencies);
    never.push(...(names(root.pnpm.neverBuiltDependencies) ?? []), ...(names(root.pnpm.ignoredBuiltDependencies) ?? []));
  }
  const workspace = ctx.project.read('pnpm-workspace.yaml');
  if (workspace) {
    only = yamlStringList(workspace, 'onlyBuiltDependencies') ?? only;
    never.push(...(yamlStringList(workspace, 'neverBuiltDependencies') ?? []), ...(yamlStringList(workspace, 'ignoredBuiltDependencies') ?? []));
  }
  return { only: only ? new Set(only) : null, never: new Set(never) };
}

export const installScript: Rule = {
  meta: {
    id: 'deps/install-script',
    level: 'warn',
    scope: 'diff',
    title: 'New package with an install script',
    summary:
      'A package that is new in the lockfile, directly or through another dependency, and runs a preinstall, install, or postinstall script (hasInstallScript in package-lock.json, requiresBuild in pnpm-lock.yaml).',
    why: 'Install scripts run with your permissions when the package is installed, before any of its code is imported. The Shai-Hulud worms spread through install scripts in compromised packages.',
    fix: 'Check what the script does (npm view <name>@<version> scripts) before installing; if it is expected, add the package to packages.allow in ubon.json.',
    cwe: ['CWE-829'],
    owasp: ['A03:2025'],
    levels: 'Skipped when the project sets ignore-scripts=true in .npmrc, and for pnpm packages that onlyBuiltDependencies leaves out or neverBuiltDependencies and ignoredBuiltDependencies list.',
  },
  project(ctx) {
    const diff = depsDiff(ctx);
    if (diff.lockfiles.length === 0 || projectIgnoresScripts(ctx)) return;
    const allow = ctx.config.packages.allow;
    const declared = new Set<string>();
    for (const p of ctx.project.packages.values()) p.allDeps.forEach((d) => declared.add(d));
    let pnpm: ReturnType<typeof pnpmBuildPolicy> | null = null;
    for (const l of diff.lockfiles) {
      const file = l.path.slice(l.path.lastIndexOf('/') + 1);
      for (const e of l.added) {
        if (!e.installScript || diff.baseSources.has(e.name) || isAllowedPackage(e.name, allow)) continue;
        if (l.lock.kind === 'pnpm') {
          pnpm ??= pnpmBuildPolicy(ctx);
          if (pnpm.never.has(e.name) || (pnpm.only && !pnpm.only.has(e.name))) continue;
        }
        const marker = l.lock.kind === 'npm' ? 'hasInstallScript' : 'requiresBuild';
        const role = declared.has(e.name) ? 'direct dependency' : 'dependency of another package';
        ctx.report(l.path, {
          line: e.line,
          message: `New package ${e.name}@${e.version} (a ${role}) runs an install script (${marker} in ${file}).`,
          fix: `Check what the script does (npm view ${e.name}@${e.version} scripts) before installing; if it is expected, add ${e.name} to packages.allow in ubon.json.`,
          key: entryKey(e),
        });
      }
    }
  },
};
