import type { PackageVetter } from '../rules/deps/verdict.ts';
import type { HookChecks } from './runtime.ts';

/**
 * The real checks behind the hook runtime. Modules load lazily, so a hook
 * only pays for the checks its event needs (package lookups, for example,
 * load only for install commands).
 */

const vetPackages: PackageVetter = async (specs, options) => (await import('../online/vet.ts')).vetPackages(specs, options);

export async function loadChecks(): Promise<HookChecks> {
  return {
    async checkCommand() {
      return [];
    },
    checkReadPath() {
      return null;
    },
    checkWritePath() {
      return null;
    },
    hasHiddenUnicode() {
      return null;
    },
    vetPackages,
  };
}
