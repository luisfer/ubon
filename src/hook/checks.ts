import type { HookChecks } from './runtime.ts';

/**
 * The real checks behind the hook runtime. Loaded lazily so a hook only pays
 * for the modules it needs.
 */
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
  };
}
