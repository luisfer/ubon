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


