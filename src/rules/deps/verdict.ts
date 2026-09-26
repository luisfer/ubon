/**
 * Shared shape for package checks. `ubon vet`, the package install command
 * check (agent/package-install), and the MCP `vet` tool all use it.
 */

export type PackageDecision = 'allow' | 'ask' | 'deny';

export interface PackageVerdict {
  /** As written, for example "lodahs@^4" or "@acme/ui". */
  spec: string;
  name: string;
  /** Version or range from the spec, when there was one. */
  version?: string;
  decision: PackageDecision;
  /** The rule behind a non-allow decision: deps/nonexistent-package, deps/young-package, deps/typosquat, deps/known-malicious. */
  rule?: string;
  /** One sentence, shown to the agent and the user. */
  reason?: string;
  /** Whether registry lookups ran for this package. */
  checked: 'online' | 'offline';
}

export interface VetOptions {
  /** Project root, for .npmrc registries and the package allow list. */
  root: string;
  /** Allow registry and OSV lookups. */
  online: boolean;
  minAgeDays: number;
  minReleaseAgeHours: number;
  /** Names or scopes (`@acme/*`) that skip the checks. */
  allow: readonly string[];
  /** Abort lookups after this many milliseconds in total (hooks have a budget). */
  timeoutMs?: number;
}

export type PackageVetter = (specs: readonly string[], options: VetOptions) => Promise<PackageVerdict[]>;
