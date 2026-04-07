import { spawnSync } from 'child_process';

const SAFE_GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/\-~^:]*$/;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/\-]{0,200}$/;
const SAFE_COMMIT_HASH = /^[0-9a-f]{7,40}$/i;

function runCommand(
  cwd: string,
  command: string,
  args: string[],
  inheritStdio = false
): { ok: boolean; stdout: string } {
  const res = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: inheritStdio ? 'inherit' : 'pipe'
  });

  if (res.error || res.status !== 0) {
    return { ok: false, stdout: '' };
  }

  return { ok: true, stdout: typeof res.stdout === 'string' ? res.stdout : '' };
}

export function isSafeGitRef(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  if (ref.startsWith('-')) return false;
  if (!SAFE_GIT_REF.test(ref)) return false;
  if (ref.includes('..') || ref.includes('@{') || ref.includes('\\')) return false;
  return true;
}

export function isSafeBranchName(branch: string): boolean {
  if (!branch || typeof branch !== 'string') return false;
  if (branch.startsWith('-')) return false;
  if (!SAFE_BRANCH.test(branch)) return false;
  if (branch.includes('..') || branch.includes('@{') || branch.includes('\\') || branch.endsWith('/')) return false;
  return true;
}

function toHttpRemoteUrl(remote: string): string {
  return remote.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '');
}

export function getChangedFilesSince(ref: string, cwd: string): string[] {
  if (!isSafeGitRef(ref)) return [];
  const out = runCommand(cwd, 'git', ['diff', '--name-only', ref]);
  if (!out.ok) {
    return [];
  }
  return out.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

export function getRecentCommitHashes(depth: number, cwd: string): string[] {
  if (!Number.isFinite(depth) || depth <= 0) return [];
  const out = runCommand(cwd, 'git', ['rev-list', `--max-count=${Math.floor(depth)}`, 'HEAD']);
  if (!out.ok) {
    return [];
  }
  return out.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter((hash) => SAFE_COMMIT_HASH.test(hash));
}

export function getCommitDiff(cwd: string, commit: string): string {
  if (!SAFE_COMMIT_HASH.test(commit)) return '';
  const out = runCommand(cwd, 'git', ['show', commit, '--unified=0']);
  if (!out.ok) return '';
  return out.stdout;
}

export interface CreatePrOptions {
  cwd: string;
  baseBranch?: string; // default: main
  featureBranch: string;
  title: string;
  body?: string;
}

export function ensureGitRepo(cwd: string): boolean {
  return runCommand(cwd, 'git', ['rev-parse', '--is-inside-work-tree']).ok;
}

export function createBranchCommitPush(options: CreatePrOptions): { pushed: boolean; remoteUrl?: string } {
  const base = options.baseBranch || 'main';
  const branch = options.featureBranch;
  if (!isSafeGitRef(base) || !isSafeBranchName(branch)) {
    return { pushed: false };
  }

  // Ensure up-to-date (best effort)
  runCommand(options.cwd, 'git', ['fetch', '--all', '--prune']);
  if (!runCommand(options.cwd, 'git', ['checkout', '-B', branch, base], true).ok) return { pushed: false };
  if (!runCommand(options.cwd, 'git', ['add', '-A'], true).ok) return { pushed: false };

  // If nothing to commit, skip commit step
  runCommand(options.cwd, 'git', ['commit', '-m', options.title], true);

  if (!runCommand(options.cwd, 'git', ['push', '-u', 'origin', branch], true).ok) return { pushed: false };

  const remote = runCommand(options.cwd, 'git', ['config', '--get', 'remote.origin.url']);
  if (!remote.ok) return { pushed: true };

  const remoteUrl = toHttpRemoteUrl(remote.stdout.trim());
  return { pushed: true, remoteUrl };
}

export function tryOpenPullRequest(cwd: string, base: string, head: string, title: string, body?: string): { created: boolean; url?: string } {
  if (!isSafeGitRef(base) || !isSafeBranchName(head)) return { created: false };

  // Try with GitHub CLI if available
  if (runCommand(cwd, 'gh', ['--version']).ok) {
    const args = ['pr', 'create', '-B', base, '-H', head, '-t', title];
    if (body) args.push('-b', body);
    if (runCommand(cwd, 'gh', args, true).ok) {
      // Best-effort; URL is printed by gh
      return { created: true };
    }
  }

  // Fallback: provide compare URL
  const remote = runCommand(cwd, 'git', ['config', '--get', 'remote.origin.url']);
  if (!remote.ok) {
    return { created: false };
  }
  const remoteUrl = toHttpRemoteUrl(remote.stdout.trim());
  const url = `${remoteUrl}/compare/${base}...${head}?expand=1&title=${encodeURIComponent(title)}`;
  return { created: false, url };
}


