import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_FILE } from '../core/config.ts';
import { toPosix } from '../core/files.ts';
import { repoRoot } from '../core/git.ts';
import { packageRoot } from '../core/package-root.ts';
import { parseJsonLoose } from '../core/project.ts';
import { PINNED_ACTIONS } from '../data/actions.ts';
import type { AgentId } from '../hook/types.ts';
import { claudeHooks, codexHooks, copilotHooks, cursorHooks, geminiHooks, isUbonCommand, launcherFor } from '../integrations/specs.ts';
import { VERSION } from '../version.ts';
import type { IO } from './io.ts';
import { EXIT } from './main.ts';

/**
 * `ubon init`: set up Ubon for a project and its agents. Dry run by default:
 * it prints every file it would create or change, and writes only with --yes.
 * JSON files are merged (Ubon's entries are found by their command, replaced
 * on update, never duplicated; nothing else changes). Markdown files get a
 * delimited block. It never creates CLAUDE.md, because Claude Code stops
 * reading AGENTS.md when a CLAUDE.md exists.
 */

const HELP = `Usage: ubon init [targets] [--yes] [--remove]

Sets up Ubon for this project. Without targets it sets up the agents it finds
(.claude/, .codex/, .cursor/, .gemini/, .github/ copilot files, and agent CLIs
on your PATH). Prints the changes and writes nothing unless --yes is given.

Targets:
  --claude       Claude Code: enable the Ubon plugin in .claude/settings.json
  --hooks-only   With --claude: write hooks and the skill into .claude/ instead of the plugin
  --codex        Codex: .codex/hooks.json and the skill in .agents/skills/
  --cursor       Cursor: .cursor/hooks.json and the skill in .agents/skills/
  --gemini       Gemini CLI: .gemini/settings.json hooks and the skill in .agents/skills/
  --copilot      GitHub Copilot: .github/hooks/ubon.json and the skill in .agents/skills/
  --git-hooks    A pre-commit hook that checks staged changes
  --github       A GitHub Actions workflow that checks pull requests
  --all          Every target above

Options:
  --yes          Write the changes
  --remove       Remove everything Ubon added
`;

export const BLOCK_BEGIN = '<!-- ubon:begin -->';
export const BLOCK_END = '<!-- ubon:end -->';

export function agentsBlock(runner: string): string {
  return `${BLOCK_BEGIN}
## Ubon

This project uses [Ubon](https://github.com/luisfer/ubon) to check changes made by coding agents.

- After you change code, and before you say a task is done, run \`${runner} check\` and fix every BLOCK finding.
- Before you install a package, run \`${runner} vet <package>\`.
- If a finding is wrong, add \`ubon-ignore <rule>: <who decided>: <evidence>\` in a comment above the line and tell the user. Write "user confirmed" as who decided only when the user did.
- Do not edit ubon.json, hook settings, or tests to get past a finding.
- \`${runner} explain <rule>\` shows what a rule checks and how to fix it.
${BLOCK_END}`;
}

type Target = AgentId | 'git-hooks' | 'github';

export interface Change {
  path: string;
  action: 'create' | 'update' | 'remove';
  /** New content (create or update). */
  content?: string;
  note?: string;
}

export interface InitPlan {
  changes: Change[];
  notes: string[];
  targets: Target[];
}

export async function runInit(argv: string[], io: IO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      claude: { type: 'boolean' },
      'hooks-only': { type: 'boolean' },
      codex: { type: 'boolean' },
      cursor: { type: 'boolean' },
      gemini: { type: 'boolean' },
      copilot: { type: 'boolean' },
      'git-hooks': { type: 'boolean' },
      github: { type: 'boolean' },
      all: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      remove: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const root = repoRoot(io.cwd) ?? io.cwd;
  const explicit: Target[] = [];
  const all: Target[] = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'git-hooks', 'github'];
  for (const t of all) if (values.all || (values as Record<string, unknown>)[t]) explicit.push(t);
  const targets = explicit.length > 0 ? explicit : detectAgents(root, io.env);
  const plan = values.remove ? planRemoval(root) : planInit(root, targets, { hooksOnly: values['hooks-only'] === true });

  if (plan.changes.length === 0) {
    io.stdout(values.remove ? 'ubon init: nothing to remove.\n' : 'ubon init: everything is already set up.\n');
    for (const n of plan.notes) io.stdout(`${n}\n`);
    return EXIT.ok;
  }
  const lines: string[] = [];
  const verb = values.yes ? '' : 'would ';
  lines.push(`ubon init ${values.remove ? '--remove' : `(${plan.targets.join(', ') || 'project files only'})`}: ${plan.changes.length} file${plan.changes.length === 1 ? '' : 's'}`);
  for (const c of plan.changes) {
    lines.push(`  ${verb}${c.action} ${c.path}${c.note ? ` (${c.note})` : ''}`);
  }
  if (!values.yes) {
    for (const c of plan.changes) {
      if (!c.content || c.content.length > 4000) continue;
      lines.push('');
      lines.push(`--- ${c.path}`);
      lines.push(c.content.trimEnd());
    }
  }
  if (plan.notes.length > 0) {
    lines.push('');
    for (const n of plan.notes) lines.push(n);
  }
  if (!values.yes) {
    lines.push('');
    lines.push('Nothing was written. Run again with --yes to apply.');
  }
  io.stdout(`${lines.join('\n')}\n`);
  if (values.yes) applyPlan(root, plan);
  return EXIT.ok;
}

export function applyPlan(root: string, plan: InitPlan): void {
  for (const c of plan.changes) {
    const full = join(root, c.path);
    if (c.action === 'remove') {
      rmSync(full, { recursive: true, force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c.content ?? '');
  }
}

// ---------------------------------------------------------------------------
// Detection

export function detectAgents(root: string, env: NodeJS.ProcessEnv): Target[] {
  const has = (p: string) => existsSync(join(root, p));
  const onPath = (name: string) => commandOnPath(name, env);
  const out: Target[] = [];
  if (has('.claude') || has('CLAUDE.md') || onPath('claude')) out.push('claude');
  if (has('.codex') || onPath('codex')) out.push('codex');
  if (has('.cursor') || has('.cursorrules') || onPath('cursor-agent')) out.push('cursor');
  if (has('.gemini') || has('GEMINI.md') || onPath('gemini')) out.push('gemini');
  if (has('.github/copilot-instructions.md') || has('.github/hooks') || has('.github/instructions') || onPath('copilot')) out.push('copilot');
  return out;
}

function commandOnPath(name: string, env: NodeJS.ProcessEnv): boolean {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return dirs.some((d) => exts.some((e) => existsSync(join(d, `${name}${e}`))));
}

// ---------------------------------------------------------------------------
// Planning

interface InitOptions {
  hooksOnly: boolean;
}

export function planInit(root: string, targets: Target[], options: InitOptions): InitPlan {
  const changes: Change[] = [];
  const notes: string[] = [];
  const localInstall = hasLocalUbon(root);
  const launcher = launcherFor(localInstall, VERSION);
  const runner = localInstall ? 'npx ubon' : `npx ubon@${VERSION}`;

  // ubon.json
  if (!existsSync(join(root, CONFIG_FILE))) {
    const config = { $schema: localInstall ? './node_modules/ubon/schema/config.json' : `https://unpkg.com/ubon@${VERSION}/schema/config.json` };
    changes.push({ path: CONFIG_FILE, action: 'create', content: `${JSON.stringify(config, null, 2)}\n` });
  }

  // AGENTS.md block (read by Codex, Cursor, Copilot, Gemini with context.fileName, and Claude Code without CLAUDE.md).
  pushMarkdownBlock(root, 'AGENTS.md', agentsBlock(runner), changes);
  if (targets.includes('claude')) {
    const claudeMd = join(root, 'CLAUDE.md');
    if (existsSync(claudeMd)) {
      const text = readFileSync(claudeMd, 'utf8');
      if (!/^@AGENTS\.md\s*$/m.test(text) && !text.includes(BLOCK_BEGIN)) {
        changes.push({ path: 'CLAUDE.md', action: 'update', content: `${text.replace(/\s*$/, '\n')}\n@AGENTS.md\n`, note: 'import AGENTS.md so Claude Code reads the Ubon block' });
      }
    }
  }

  const skillTargets = new Set<string>();
  for (const target of targets) {
    switch (target) {
      case 'claude':
        if (options.hooksOnly) {
          mergeJson(root, '.claude/settings.json', changes, notes, (data) => mergeHookMap(data, 'hooks', claudeHooks(launcher)));
          skillTargets.add('.claude/skills/ubon');
        } else {
          mergeJson(root, '.claude/settings.json', changes, notes, (data) => {
            const markets = (data.extraKnownMarketplaces ?? {}) as Record<string, unknown>;
            markets.ubon = { source: { source: 'github', repo: 'luisfer/ubon' } };
            data.extraKnownMarketplaces = markets;
            const enabled = (data.enabledPlugins ?? {}) as Record<string, unknown>;
            enabled['ubon@ubon'] = true;
            data.enabledPlugins = enabled;
            return data;
          });
          notes.push('Claude Code: team members are asked to install the Ubon plugin when they trust this folder. To install it yourself now: /plugin marketplace add luisfer/ubon, then /plugin install ubon@ubon.');
        }
        break;
      case 'codex':
        mergeJson(root, '.codex/hooks.json', changes, notes, (data) => mergeHookMap(data, 'hooks', codexHooks(launcher)));
        skillTargets.add('.agents/skills/ubon');
        notes.push('Codex: review and trust the new hooks once with /hooks.');
        break;
      case 'cursor':
        mergeJson(root, '.cursor/hooks.json', changes, notes, (data) => {
          data.version = 1;
          return mergeHookMap(data, 'hooks', cursorHooks(launcher));
        });
        skillTargets.add('.agents/skills/ubon');
        break;
      case 'gemini':
        mergeJson(root, '.gemini/settings.json', changes, notes, (data) => {
          mergeHookMap(data, 'hooks', geminiHooks(launcher));
          const context = (data.context ?? {}) as Record<string, unknown>;
          const names = Array.isArray(context.fileName) ? (context.fileName as unknown[]).map(String) : typeof context.fileName === 'string' ? [context.fileName] : ['GEMINI.md'];
          if (!names.includes('AGENTS.md')) names.push('AGENTS.md');
          context.fileName = names;
          data.context = context;
          return data;
        });
        skillTargets.add('.agents/skills/ubon');
        notes.push('Gemini CLI: project hooks must be trusted again after they change.');
        break;
      case 'copilot':
        mergeJson(root, '.github/hooks/ubon.json', changes, notes, (data) => {
          data.version = 1;
          return mergeHookMap(data, 'hooks', copilotHooks(launcher));
        });
        skillTargets.add('.agents/skills/ubon');
        if (!localInstall) notes.push('GitHub Copilot cloud agent: add Ubon as a dev dependency so the hooks do not download it in the sandbox.');
        break;
      case 'git-hooks':
        planGitHook(root, runner, changes, notes);
        break;
      case 'github':
        if (!existsSync(join(root, '.github/workflows/ubon.yml'))) changes.push({ path: '.github/workflows/ubon.yml', action: 'create', content: githubWorkflow() });
        break;
    }
  }
  for (const dest of skillTargets) planSkillCopy(root, dest, changes, notes);
  if (!localInstall) notes.push(`Ubon is not a dev dependency of this project, so hooks run a pinned version with npx (ubon@${VERSION}). For faster hooks and a lockfile-pinned version: npm install --save-dev ubon, then run ubon init again.`);
  return { changes, notes, targets };
}

function hasLocalUbon(root: string): boolean {
  const pkg = parseJsonLoose(safeRead(join(root, 'package.json')) ?? '');
  if (!pkg) return false;
  return Boolean((pkg.devDependencies as Record<string, unknown> | undefined)?.ubon || (pkg.dependencies as Record<string, unknown> | undefined)?.ubon);
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function pushMarkdownBlock(root: string, file: string, block: string, changes: Change[]): void {
  const full = join(root, file);
  const existing = safeRead(full);
  if (existing === null) {
    changes.push({ path: file, action: 'create', content: `${block}\n` });
    return;
  }
  const start = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END);
  let next: string;
  if (start !== -1 && end > start) next = `${existing.slice(0, start)}${block}${existing.slice(end + BLOCK_END.length)}`;
  else next = `${existing.replace(/\s*$/, '\n')}\n${block}\n`;
  if (next !== existing) changes.push({ path: file, action: 'update', content: next, note: 'Ubon block between ubon:begin and ubon:end' });
}

/** Merge into a JSON file. Files with comments are not rewritten (comments would be lost); a note explains what to add. */
function mergeJson(root: string, file: string, changes: Change[], notes: string[], edit: (data: Record<string, unknown>) => Record<string, unknown>): void {
  const full = join(root, file);
  const existing = safeRead(full);
  let data: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      data = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      const loose = parseJsonLoose(existing);
      notes.push(
        loose
          ? `${file} has comments or trailing commas, so Ubon did not rewrite it. Add the entries shown by \`ubon init --yes\` in a copy without comments, or edit it by hand.`
          : `${file} is not valid JSON, so Ubon did not change it.`,
      );
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      notes.push(`${file} is not a JSON object, so Ubon did not change it.`);
      return;
    }
  }
  const next = `${JSON.stringify(edit(structuredClone(data)), null, 2)}\n`;
  if (existing === null) changes.push({ path: file, action: 'create', content: next });
  else if (normalizeJson(existing) !== normalizeJson(next)) changes.push({ path: file, action: 'update', content: next, note: 'merged; other entries kept' });
}

function normalizeJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/** Replace Ubon's entries for each event, keep everything else. */
export function mergeHookMap(data: Record<string, unknown>, key: string, ours: Record<string, unknown[]>): Record<string, unknown> {
  const hooks = (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]) ? data[key] : {}) as Record<string, unknown>;
  for (const [event, entries] of Object.entries(ours)) {
    const current = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...current.filter((entry) => !entryRunsUbon(entry)), ...entries];
  }
  data[key] = hooks;
  return data;
}

export function removeUbonHooks(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const hooks = data[key];
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return data;
  for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry) => !entryRunsUbon(entry));
    if (kept.length === 0) delete (hooks as Record<string, unknown>)[event];
    else (hooks as Record<string, unknown>)[event] = kept;
  }
  return data;
}

export function entryRunsUbon(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  if (isUbonCommand(e.command) || isUbonCommand(e.bash) || isUbonCommand(e.powershell)) return true;
  if (Array.isArray(e.args) && isUbonCommand(`${String(e.command ?? '')} ${(e.args as unknown[]).map(String).join(' ')}`)) return true;
  if (Array.isArray(e.hooks)) return (e.hooks as unknown[]).some((h) => entryRunsUbon(h));
  return false;
}

function planSkillCopy(root: string, dest: string, changes: Change[], notes: string[]): void {
  const pkg = packageRoot();
  const source = pkg ? join(pkg, 'skills', 'ubon') : null;
  if (!source || !existsSync(source)) {
    notes.push(`The Ubon skill was not found in the installed package, so ${dest} was not written.`);
    return;
  }
  for (const file of listFiles(source)) {
    const content = readFileSync(join(source, file), 'utf8');
    const target = `${dest}/${file}`;
    const existing = safeRead(join(root, target));
    if (existing === content) continue;
    changes.push({ path: target, action: existing === null ? 'create' : 'update', ...(file === 'SKILL.md' ? { content } : { content }) });
  }
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out.sort();
}

function planGitHook(root: string, runner: string, changes: Change[], notes: string[]): void {
  const command = `${runner} check --staged`;
  const husky = join(root, '.husky', 'pre-commit');
  if (existsSync(join(root, '.husky'))) {
    const existing = safeRead(husky);
    if (existing?.includes('ubon check')) return;
    changes.push({ path: '.husky/pre-commit', action: existing === null ? 'create' : 'update', content: `${existing ? existing.replace(/\s*$/, '\n') : ''}${command}\n`, note: 'husky' });
    return;
  }
  const precommit = safeRead(join(root, '.pre-commit-config.yaml'));
  if (precommit !== null) {
    if (precommit.includes('luisfer/ubon')) return;
    changes.push({
      path: '.pre-commit-config.yaml',
      action: 'update',
      content: `${precommit.replace(/\s*$/, '\n')}  - repo: https://github.com/luisfer/ubon\n    rev: v${VERSION}\n    hooks:\n      - id: ubon\n`,
      note: 'pre-commit framework',
    });
    if (!/^repos:/m.test(precommit)) notes.push('.pre-commit-config.yaml has no top-level repos: key; check the added entry.');
    return;
  }
  const lefthook = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml'].find((f) => existsSync(join(root, f)));
  if (lefthook) {
    notes.push(`${lefthook}: add a pre-commit command that runs "${command}" (Ubon does not rewrite lefthook files).`);
    return;
  }
  const hook = '.githooks/pre-commit';
  if (!existsSync(join(root, hook))) {
    changes.push({ path: hook, action: 'create', content: `#!/bin/sh\n# Generated by ubon init: checks what this commit will record.\n${command}\n` });
  }
  notes.push('Git: enable the hook with `git config core.hooksPath .githooks` (Ubon does not change git config for you).');
}

export function githubWorkflow(): string {
  return `# Generated by ubon init. See https://github.com/luisfer/ubon/blob/main/docs/ci.md
name: ubon
on:
  pull_request:
permissions:
  contents: read
jobs:
  ubon:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: ${PINNED_ACTIONS.checkout.uses} # ${PINNED_ACTIONS.checkout.version}
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: ${PINNED_ACTIONS.setupNode.uses} # ${PINNED_ACTIONS.setupNode.version}
        with:
          node-version: 24
      - name: ubon check
        run: npx --yes ubon@${VERSION} check --base "origin/\${GITHUB_BASE_REF}" --format sarif --output ubon.sarif --summary "$GITHUB_STEP_SUMMARY"
      - uses: ${PINNED_ACTIONS.uploadSarif.uses} # ${PINNED_ACTIONS.uploadSarif.version}
        if: always()
        with:
          sarif_file: ubon.sarif
          category: ubon
`;
}

// ---------------------------------------------------------------------------
// Removal

export function planRemoval(root: string): InitPlan {
  const changes: Change[] = [];
  const notes: string[] = [];
  const agents = safeRead(join(root, 'AGENTS.md'));
  if (agents?.includes(BLOCK_BEGIN)) {
    const start = agents.indexOf(BLOCK_BEGIN);
    const end = agents.indexOf(BLOCK_END);
    if (end > start) {
      const next = `${agents.slice(0, start).replace(/\s*$/, '')}\n${agents.slice(end + BLOCK_END.length).replace(/^\s*/, '')}`.replace(/^\n+/, '');
      changes.push(next.trim() === '' ? { path: 'AGENTS.md', action: 'remove' } : { path: 'AGENTS.md', action: 'update', content: next.endsWith('\n') ? next : `${next}\n` });
    }
  }
  const jsonFiles: Array<[string, string]> = [
    ['.claude/settings.json', 'hooks'],
    ['.codex/hooks.json', 'hooks'],
    ['.cursor/hooks.json', 'hooks'],
    ['.gemini/settings.json', 'hooks'],
  ];
  for (const [file, key] of jsonFiles) {
    const text = safeRead(join(root, file));
    if (text === null) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const before = JSON.stringify(data);
    removeUbonHooks(data, key);
    if (file === '.claude/settings.json') {
      const markets = data.extraKnownMarketplaces as Record<string, unknown> | undefined;
      if (markets?.ubon) delete markets.ubon;
      const enabled = data.enabledPlugins as Record<string, unknown> | undefined;
      if (enabled && 'ubon@ubon' in enabled) delete enabled['ubon@ubon'];
    }
    if (JSON.stringify(data) !== before) changes.push({ path: file, action: 'update', content: `${JSON.stringify(data, null, 2)}\n` });
  }
  if (existsSync(join(root, '.github/hooks/ubon.json'))) changes.push({ path: '.github/hooks/ubon.json', action: 'remove' });
  for (const dir of ['.agents/skills/ubon', '.claude/skills/ubon']) if (existsSync(join(root, dir))) changes.push({ path: dir, action: 'remove' });
  const workflow = safeRead(join(root, '.github/workflows/ubon.yml'));
  if (workflow?.startsWith('# Generated by ubon init')) changes.push({ path: '.github/workflows/ubon.yml', action: 'remove' });
  const githook = safeRead(join(root, '.githooks/pre-commit'));
  if (githook?.includes('# Generated by ubon init')) changes.push({ path: '.githooks/pre-commit', action: 'remove' });
  if (existsSync(join(root, CONFIG_FILE))) notes.push(`${CONFIG_FILE} was kept; delete it yourself if you no longer want it.`);
  return { changes, notes, targets: [] };
}

export function relativeTo(root: string, path: string): string {
  return toPosix(relative(root, path));
}
