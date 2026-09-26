import type { UbonConfig } from '../../core/config.ts';
import type { PackageVerdict } from '../deps/verdict.ts';

/**
 * Shared shape for checks that run before an agent acts: shell commands,
 * file reads, and file writes. The hook runtime maps these verdicts to each
 * agent's output format.
 */

export type ActionDecision = 'ask' | 'deny';

export interface ActionVerdict {
  /** Rule ID, for example agent/destructive-command. */
  rule: string;
  decision: ActionDecision;
  /** One sentence for the agent and the user: what is wrong. */
  reason: string;
  /** One sentence: what to do instead, or how a person can allow it. */
  fix: string;
}

export interface CommandContext {
  /** Directory the command runs in (absolute). */
  cwd: string;
  /** Project root (git root or cwd). */
  root: string;
  config: UbonConfig;
  /** True when the working tree has uncommitted changes (for git reset --hard, git clean). Lazy: only called when needed. */
  hasUncommittedChanges(): boolean;
  /** Current branch name, or null. Lazy. */
  currentBranch(): string | null;
  /** Package checks for install commands; absent when not available. */
  vetPackages?: (specs: readonly string[]) => Promise<PackageVerdict[]>;
}
