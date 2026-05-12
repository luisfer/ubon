/**
 * `ubon doctor` — environment diagnostic. Mirrors `eslint --print-config`
 * style: tells the user exactly what Ubon thinks about their environment so
 * support requests can be debugged without back-and-forth.
 *
 * Outputs are intentionally cheap (no scan run): we only check that the
 * binaries / optional deps Ubon depends on are reachable.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import pkg from '../../package.json';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

function check(name: string, fn: () => CheckResult | Promise<CheckResult>): Promise<CheckResult> {
  return Promise.resolve()
    .then(fn)
    .catch((error) => ({ name, status: 'fail', detail: error?.message || String(error) }));
}

function tryExec(cmd: string, args: string[] = []): string | null {
  try {
    // ubon-disable-next-line SEC026 argv-safe execFileSync wrapper for fixed doctor probes
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export async function runDoctor(
  directory: string = process.cwd(),
  options: { agentHarness?: boolean } = {}
): Promise<void> {
  const checks: Promise<CheckResult>[] = [];

  checks.push(
    check('Ubon version', async () => ({
      name: 'Ubon version',
      status: 'ok',
      detail: `${(pkg as any).version}`
    }))
  );

  checks.push(
    check('Node.js', async () => {
      const major = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
      const status: CheckResult['status'] = major >= 20 ? 'ok' : 'fail';
      return {
        name: 'Node.js',
        status,
        detail: `${process.versions.node}${major < 20 ? ' (Ubon v3 requires Node 20+)' : ''}`
      };
    })
  );

  checks.push(
    check('Project package.json', async () => {
      const pkgPath = join(directory, 'package.json');
      if (!existsSync(pkgPath)) {
        return { name: 'Project package.json', status: 'warn', detail: 'no package.json detected — profile auto-detection limited' };
      }
      return { name: 'Project package.json', status: 'ok', detail: pkgPath };
    })
  );

  checks.push(
    check('git', async () => {
      const v = tryExec('git', ['--version']);
      return v
        ? { name: 'git', status: 'ok', detail: v }
        : { name: 'git', status: 'warn', detail: 'git not on PATH — git-history scanner and --git-changed-since disabled' };
    })
  );

  checks.push(
    check('@modelcontextprotocol/sdk', async () => {
      try {
        require.resolve('@modelcontextprotocol/sdk/package.json');
        return { name: '@modelcontextprotocol/sdk', status: 'ok', detail: 'installed — `ubon mcp` available' };
      } catch {
        return {
          name: '@modelcontextprotocol/sdk',
          status: 'warn',
          detail: 'not installed — install with `npm i -g @modelcontextprotocol/sdk` to enable `ubon mcp`'
        };
      }
    })
  );

  checks.push(
    check('puppeteer (deprecated)', async () => {
      try {
        require.resolve('puppeteer/package.json');
        return {
          name: 'puppeteer',
          status: 'warn',
          detail: 'installed — `--crawl-internal` works but is deprecated and slated for removal in v3.1'
        };
      } catch {
        return { name: 'puppeteer', status: 'ok', detail: 'not installed (recommended)' };
      }
    })
  );

  if (options.agentHarness) {
    checks.push(
      check('Cursor hooks', async () => {
        const hooks = join(directory, '.cursor', 'hooks.json');
        return existsSync(hooks)
          ? { name: 'Cursor hooks', status: 'ok', detail: hooks }
          : { name: 'Cursor hooks', status: 'warn', detail: 'not installed — run `ubon agent install --cursor --write`' };
      })
    );

    checks.push(
      check('Agent guidance', async () => {
        const hasGuidance = existsSync(join(directory, 'AGENTS.md')) ||
          existsSync(join(directory, 'CLAUDE.md')) ||
          existsSync(join(directory, '.cursor', 'rules', 'ubon.mdc'));
        return hasGuidance
          ? { name: 'Agent guidance', status: 'ok', detail: 'found repo-level agent instructions' }
          : { name: 'Agent guidance', status: 'warn', detail: 'no AGENTS.md, CLAUDE.md, or .cursor/rules/ubon.mdc found' };
      })
    );

    checks.push(
      check('Pre-commit hook', async () => {
        const preCommit = join(directory, '.pre-commit-config.yaml');
        return existsSync(preCommit)
          ? { name: 'Pre-commit hook', status: 'ok', detail: preCommit }
          : { name: 'Pre-commit hook', status: 'warn', detail: 'not configured — run `ubon agent install --pre-commit --write`' };
      })
    );

    checks.push(
      check('Ubon cache ignore', async () => {
        const gitignore = join(directory, '.gitignore');
        const ignored = existsSync(gitignore) && readFileSync(gitignore, 'utf-8').split(/\r?\n/).includes('.ubon/');
        return ignored
          ? { name: 'Ubon cache ignore', status: 'ok', detail: '.ubon/ is ignored' }
          : { name: 'Ubon cache ignore', status: 'warn', detail: 'add .ubon/ to .gitignore for repo-local result caches' };
      })
    );

    checks.push(
      check('GitHub Ubon workflow', async () => {
        const workflow = join(directory, '.github', 'workflows', 'ubon.yml');
        return existsSync(workflow)
          ? { name: 'GitHub Ubon workflow', status: 'ok', detail: workflow }
          : { name: 'GitHub Ubon workflow', status: 'warn', detail: 'not configured — run `ubon agent install --github --write`' };
      })
    );
  }

  const results = await Promise.all(checks);

  const icon: Record<CheckResult['status'], string> = { ok: '🪷', warn: '⚠️', fail: '❌' };
  console.log('🪷 Ubon doctor');
  console.log('─'.repeat(50));
  for (const r of results) {
    console.log(`${icon[r.status]}  ${r.name.padEnd(28)} ${r.detail}`);
  }
  console.log('');

  const fails = results.filter((r) => r.status === 'fail').length;
  if (fails > 0) {
    console.log(`${fails} blocker(s) — please address before running ubon.`);
    process.exit(1);
  }
}
