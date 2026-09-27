import { pathContexts } from '../core/context.ts';
import type { PackageVetter } from '../rules/deps/verdict.ts';
import type { HookChecks } from './runtime.ts';

/**
 * The real checks behind the hook runtime. Modules load lazily, so a hook
 * only pays for the checks its event needs (package lookups, for example,
 * load only for install commands).
 */

const vetPackages: PackageVetter = async (specs, options) => (await import('../online/vet.ts')).vetPackages(specs, options);

export async function loadChecks(): Promise<HookChecks> {
  const [commands, paths, unicode] = await Promise.all([import('../rules/agent/commands.ts'), import('../rules/agent/paths.ts'), import('../rules/agent/hidden-unicode.ts')]);
  return {
    checkCommand: (command, ctx) => commands.checkCommand(command, ctx),
    // A path can match several protected patterns; the first verdict says enough.
    checkReadPath: (path, ctx) => paths.checkReadPath(path, ctx)[0] ?? null,
    checkWritePath: (path, ctx) => paths.checkWritePath(path, ctx)[0] ?? null,
    hasHiddenUnicode(text, path) {
      const found = unicode.findHiddenUnicode(text, { agentFile: pathContexts(path).has('agent') }).find((h) => h.level === 'block');
      return found ? `The content for ${path} contains ${found.what} (line ${found.line}), which is invisible when the file is read.` : null;
    },
    vetPackages,
  };
}
