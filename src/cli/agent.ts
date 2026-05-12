import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { installCursorHooks } from './hooks';
import { renderPreCommitConfig } from '../utils/hooks';

interface AgentInstallOptions {
  directory: string;
  cursor?: boolean;
  claude?: boolean;
  codex?: boolean;
  preCommit?: boolean;
  github?: boolean;
  all?: boolean;
  write?: boolean;
  force?: boolean;
}

interface PlannedFile {
  path: string;
  content: string;
  mode?: number;
}

const CURSOR_RULE = `---
description: Ubon security scanner integration
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.svelte", "**/*.astro"]
---

# Ubon

- Use \`ubon verify\` before shipping agent-generated changes.
- Use \`ubon check --preset agent\` for fast local feedback.
- Use \`ubon review --since origin/main\` before opening a PR.
- Treat high-severity findings with confidence >= 0.85 as blockers unless explicitly suppressed with a reason.
`;

const AGENTS_SECTION = `# Agent guidance

## Ubon

- Run \`ubon verify\` before considering implementation work complete.
- For fast inner-loop checks, run \`ubon check --preset agent\`.
- For PR review, run \`ubon review --since origin/main\`.
- Do not ignore high-severity Ubon findings unless there is an explicit suppression reason.
`;

const GITHUB_WORKFLOW = `name: Ubon

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx ubon@latest verify
`;

function shouldTarget(options: AgentInstallOptions, key: keyof AgentInstallOptions): boolean {
  return !!options.all || !!options[key];
}

function writePlannedFile(file: PlannedFile, force: boolean, wrote: string[], skipped: string[]): void {
  if (existsSync(file.path) && !force) {
    skipped.push(file.path);
    return;
  }
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, file.content, 'utf-8');
  if (file.mode !== undefined) {
    try {
      chmodSync(file.path, file.mode);
    } catch {}
  }
  wrote.push(file.path);
}

function appendGitignore(directory: string, skipped: string[]): PlannedFile | null {
  const gitignore = join(directory, '.gitignore');
  const line = '.ubon/';
  const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf-8') : '';
  if (current.split(/\r?\n/).includes(line)) {
    skipped.push(gitignore);
    return null;
  }
  const content = `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${line}\n`;
  const planned = { path: gitignore, content };
  return planned;
}

export function installAgentHarness(options: AgentInstallOptions): { planned: string[]; wrote: string[]; skipped: string[] } {
  const directory = options.directory;
  const dryRun = !options.write;
  const force = !!options.force;
  const wrote: string[] = [];
  const skipped: string[] = [];
  const plannedFiles: PlannedFile[] = [];

  const anyTarget = options.all || options.cursor || options.claude || options.codex || options.preCommit || options.github;
  const targets = anyTarget ? options : { ...options, cursor: true };

  if (shouldTarget(targets, 'cursor')) {
    plannedFiles.push({ path: join(directory, '.cursor/rules/ubon.mdc'), content: CURSOR_RULE });
  }

  if (shouldTarget(targets, 'codex')) {
    plannedFiles.push({ path: join(directory, 'AGENTS.md'), content: AGENTS_SECTION });
  }

  if (shouldTarget(targets, 'claude')) {
    plannedFiles.push({ path: join(directory, 'CLAUDE.md'), content: AGENTS_SECTION.replace('# Agent guidance', '# Claude Code guidance') });
  }

  if (shouldTarget(targets, 'preCommit')) {
    plannedFiles.push({ path: join(directory, '.pre-commit-config.yaml'), content: renderPreCommitConfig({ mode: 'fast', failOn: 'error' }) });
  }

  if (shouldTarget(targets, 'github')) {
    plannedFiles.push({ path: join(directory, '.github/workflows/ubon.yml'), content: GITHUB_WORKFLOW });
  }

  const gitignorePlan = appendGitignore(directory, skipped);
  if (gitignorePlan) plannedFiles.push(gitignorePlan);

  if (!dryRun) {
    for (const file of plannedFiles) writePlannedFile(file, force, wrote, skipped);
    if (shouldTarget(targets, 'cursor')) {
      const cursor = installCursorHooks({ directory, cursor: true, force });
      wrote.push(...cursor.wrote);
      skipped.push(...cursor.skipped);
    }
  }

  return {
    planned: plannedFiles.map((file) => file.path),
    wrote,
    skipped
  };
}
