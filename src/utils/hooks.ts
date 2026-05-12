import { existsSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

export interface HookOptions {
  mode?: 'fast' | 'full';
  failOn?: 'error' | 'warning';
  directory?: string;
  dryRun?: boolean;
  install?: boolean;
}

export function renderPreCommitConfig(options: HookOptions): string {
  const mode = options.mode || 'fast';
  const failOn = options.failOn || 'error';
  const entry = `ubon check --git-changed-since HEAD ${mode === 'fast' ? '--fast' : ''} --fail-on ${failOn}`.trim();

  return `repos:\n  - repo: local\n    hooks:\n      - id: ubon-security-check\n        name: Ubon Security Scanner\n        entry: ${entry}\n        language: system\n        files: \\\\.(js|jsx|ts|tsx|svelte|astro)$\n        pass_filenames: false\n`;
}

export function installPreCommitHooks(options: HookOptions): void {
  const directory = options.directory || process.cwd();
  if (!existsSync(join(directory, '.git'))) {
    throw new Error('Not a git repository (missing .git)');
  }

  const yaml = renderPreCommitConfig(options);
  const target = join(directory, '.pre-commit-config.yaml');

  if (options.dryRun) {
    console.log(yaml);
    return;
  }

  writeFileSync(target, yaml);
  console.log(`✅ Created ${target}`);

  if (options.install === false) return;

  try {
    execFileSync('pre-commit', ['--version'], { cwd: directory, stdio: 'ignore' });
  } catch {
    console.log('⚠️  pre-commit not installed. Install with: pip install pre-commit');
    console.log('Then run: pre-commit install');
    return;
  }

  execFileSync('pre-commit', ['install'], { cwd: directory, stdio: 'inherit' });
  console.log('✅ Ubon pre-commit hooks installed successfully');
}


