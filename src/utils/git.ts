import { execSync } from 'child_process';

export function getChangedFilesSince(ref: string, cwd: string): string[] {
  try {
    const out = execSync(`git diff --name-only ${ref}`, { cwd, encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getRecentCommitHashes(depth: number, cwd: string): string[] {
  try {
    const out = execSync(`git rev-list --max-count=${depth} HEAD`, { cwd, encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface CreatePrOptions {
  cwd: string;
  baseBranch?: string; // default: main
  featureBranch: string;
  title: string;
  body?: string;
}

export function ensureGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function createBranchCommitPush(options: CreatePrOptions): { pushed: boolean; remoteUrl?: string } {
  const base = options.baseBranch || 'main';
  const branch = options.featureBranch;
  try {
    // Ensure up-to-date
    try { execSync('git fetch --all --prune', { cwd: options.cwd, stdio: 'ignore' }); } catch {}
    // Create and switch to feature branch
    execSync(`git checkout -B ${branch} ${base}`, { cwd: options.cwd, stdio: 'inherit' });
    // Stage and commit
    execSync('git add -A', { cwd: options.cwd, stdio: 'inherit' });
    // If nothing to commit, skip commit step
    try {
      execSync(`git commit -m "${options.title.replace(/"/g, '\\"')}"`, { cwd: options.cwd, stdio: 'inherit' });
    } catch {}
    // Push branch
    execSync(`git push -u origin ${branch}`, { cwd: options.cwd, stdio: 'inherit' });
    // Get repo url
    const remote = execSync('git config --get remote.origin.url', { cwd: options.cwd, encoding: 'utf8' }).trim();
    const remoteUrl = remote.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '');
    return { pushed: true, remoteUrl };
  } catch {
    return { pushed: false };
  }
}

export function tryOpenPullRequest(cwd: string, base: string, head: string, title: string, body?: string): { created: boolean; url?: string } {
  // Try with GitHub CLI if available
  try {
    execSync('gh --version', { cwd, stdio: 'ignore' });
    const args = ['pr', 'create', '-B', base, '-H', head, '-t', JSON.stringify(title)];
    if (body) args.push('-b', JSON.stringify(body));
    execSync(`gh ${args.join(' ')}`, { cwd, stdio: 'inherit' });
    // Best-effort; URL is printed by gh
    return { created: true };
  } catch {}
  // Fallback: provide compare URL
  try {
    const remote = execSync('git config --get remote.origin.url', { cwd, encoding: 'utf8' }).trim();
    const remoteUrl = remote.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '');
    const url = `${remoteUrl}/compare/${base}...${head}?expand=1&title=${encodeURIComponent(title)}`;
    return { created: false, url };
  } catch {
    return { created: false };
  }
}


