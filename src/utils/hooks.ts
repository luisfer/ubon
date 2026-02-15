import { existsSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';

export interface HookOptions {
  mode?: 'fast' | 'full';
  failOn?: 'error' | 'warning';
}

export function installPreCommitHooks(options: HookOptions): void {
  if (!existsSync('.git')) {
    throw new Error('Not a git repository (missing .git)');
  }

  const mode = options.mode || 'fast';
  const failOn = options.failOn || 'error';
  const entry = `ubon check --git-changed-since HEAD ${mode === 'fast' ? '--fast' : ''} --fail-on ${failOn}`.trim();

  const yaml = `repos:\n  - repo: local\n    hooks:\n      - id: ubon-security-check\n        name: Ubon Security Scanner\n        entry: ${entry}\n        language: system\n        files: \\\.(js|jsx|ts|tsx|py)$\n        pass_filenames: false\n`;

  writeFileSync('.pre-commit-config.yaml', yaml);
  console.log('✅ Created .pre-commit-config.yaml');

  const version = spawnSync('pre-commit', ['--version'], { stdio: 'ignore' });
  if (version.error || version.status !== 0) {
    console.log('⚠️  pre-commit not installed. Install with: pip install pre-commit');
    console.log('Then run: pre-commit install');
    return;
  }

  const install = spawnSync('pre-commit', ['install'], { stdio: 'inherit' });
  if (install.error || install.status !== 0) {
    throw new Error('Failed to install pre-commit hooks');
  }
  console.log('✅ Ubon pre-commit hooks installed successfully');
}


