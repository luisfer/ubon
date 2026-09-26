import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_FILE, ConfigError, loadConfig } from '../core/config.ts';
import { git, gitDir, repoRoot } from '../core/git.ts';
import { packageRoot } from '../core/package-root.ts';
import { readEvents, recentSessions, stateDir } from '../core/session.ts';
import { adapterFor } from '../hook/adapters/index.ts';
import type { AgentId } from '../hook/types.ts';
import { HOOK_SPECS, isUbonCommand } from '../integrations/specs.ts';
import { ruleIds } from '../rules/index.ts';
import { VERSION } from '../version.ts';
import { BLOCK_BEGIN, entryRunsUbon } from './init.ts';
import type { IO } from './io.ts';
import { EXIT } from './main.ts';

/**
 * `ubon doctor`: checks the installation, the integrations in this project,
 * and recent hook activity. Exit code 1 when something is broken.
 */

const HELP = `Usage: ubon doctor [--json]

Checks Node.js, the Ubon installation, ubon.json, the hook configuration of
each agent in this project, the skill files, and recent hook activity from
the session log. Exits with 1 when something is broken.
`;

type Status = 'ok' | 'warn' | 'error' | 'info';

export interface DoctorItem {
  status: Status;
  subject: string;
  detail: string;
}

export async function runDoctor(argv: string[], io: IO): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: true, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const root = repoRoot(io.cwd) ?? io.cwd;
  const items = diagnose(root, io.env);
  const activity = recentActivity(root);
  if (values.json) {
    io.stdout(`${JSON.stringify({ version: VERSION, root, items, activity }, null, 2)}\n`);
  } else {
    const lines = [`ubon doctor ${VERSION}`, ''];
    for (const item of items) lines.push(`${item.status.padEnd(5)}  ${item.subject}: ${item.detail}`);
    lines.push('');
    if (activity.length === 0) lines.push('Recent hook activity: none recorded in this project.');
    else {
      lines.push('Recent hook activity:');
      for (const a of activity) lines.push(`  ${a}`);
    }
    io.stdout(`${lines.join('\n')}\n`);
  }
  return items.some((i) => i.status === 'error') ? EXIT.findings : EXIT.ok;
}

export function diagnose(root: string, env: NodeJS.ProcessEnv): DoctorItem[] {
  const items: DoctorItem[] = [];
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 18);
  items.push({ status: nodeOk ? 'ok' : 'error', subject: 'Node.js', detail: `${process.versions.node}${nodeOk ? '' : ' (Ubon needs 22.18 or newer)'}` });

  const pkg = packageRoot();
  const local = existsSync(join(root, 'node_modules', 'ubon', 'package.json'));
  items.push({ status: 'ok', subject: 'ubon', detail: `${VERSION} from ${pkg ?? 'an unknown location'}${local ? ' (project dev dependency installed)' : ''}` });

  const isGit = gitDir(root) !== null;
  items.push({ status: isGit ? 'ok' : 'warn', subject: 'project', detail: `${root}${isGit ? ' (git)' : ' (not a git repository: diff and session checks fall back to every file)'}` });

  try {
    const dir = join(stateDir(root), 'doctor-probe');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'probe'), 'ok');
    rmSync(dir, { recursive: true, force: true });
    items.push({ status: 'ok', subject: 'session state', detail: stateDir(root) });
  } catch (error) {
    items.push({ status: 'error', subject: 'session state', detail: `cannot write to ${stateDir(root)} (${(error as Error).message}); the stop gate cannot record a base` });
  }

  if (!existsSync(join(root, CONFIG_FILE))) items.push({ status: 'info', subject: CONFIG_FILE, detail: 'not present; defaults apply' });
  else {
    try {
      loadConfig(root, ruleIds());
      items.push({ status: 'ok', subject: CONFIG_FILE, detail: 'valid' });
    } catch (error) {
      items.push({ status: 'error', subject: CONFIG_FILE, detail: error instanceof ConfigError ? error.message : String(error) });
    }
  }

  items.push(...checkIntegrations(root, local));

  const agentsMd = safeRead(join(root, 'AGENTS.md'));
  const claudeMd = safeRead(join(root, 'CLAUDE.md'));
  if (agentsMd?.includes(BLOCK_BEGIN)) {
    items.push({ status: 'ok', subject: 'AGENTS.md', detail: 'has the Ubon block' });
    if (claudeMd !== null && !/^@AGENTS\.md\s*$/m.test(claudeMd) && !claudeMd.includes(BLOCK_BEGIN)) {
      items.push({ status: 'warn', subject: 'CLAUDE.md', detail: 'exists without an @AGENTS.md line, so Claude Code does not read the Ubon block in AGENTS.md' });
    }
  }
  for (const skill of ['.agents/skills/ubon/SKILL.md', '.claude/skills/ubon/SKILL.md', '.github/skills/ubon/SKILL.md']) {
    if (existsSync(join(root, skill))) {
      const text = safeRead(join(root, skill)) ?? '';
      const m = /ubon-version:\s*"?([\w.-]+)"?/.exec(text);
      const stale = m && m[1] !== VERSION;
      items.push({ status: stale ? 'warn' : 'ok', subject: 'skill', detail: `${skill}${stale ? ` is from ubon ${m?.[1]}; run ubon init --yes to update it` : ''}` });
    }
  }
  const hooksPath = git(root, ['config', '--get', 'core.hooksPath'])?.trim();
  const preCommit = [hooksPath ? join(hooksPath, 'pre-commit') : null, '.husky/pre-commit', '.git/hooks/pre-commit'].filter((p): p is string => !!p);
  const withUbon = preCommit.find((p) => (safeRead(join(root, p)) ?? '').includes('ubon check'));
  const framework = (safeRead(join(root, '.pre-commit-config.yaml')) ?? '').includes('luisfer/ubon');
  if (withUbon || framework) items.push({ status: 'ok', subject: 'git hooks', detail: withUbon ? `${withUbon} runs ubon check` : '.pre-commit-config.yaml runs ubon' });
  void env;
  return items;
}

interface ConfigFile {
  agent: AgentId;
  file: string;
  hooksKey: string;
}

const CONFIG_FILES: ConfigFile[] = [
  { agent: 'claude', file: '.claude/settings.json', hooksKey: 'hooks' },
  { agent: 'claude', file: '.claude/settings.local.json', hooksKey: 'hooks' },
  { agent: 'codex', file: '.codex/hooks.json', hooksKey: 'hooks' },
  { agent: 'cursor', file: '.cursor/hooks.json', hooksKey: 'hooks' },
  { agent: 'gemini', file: '.gemini/settings.json', hooksKey: 'hooks' },
];

const AGENT_NAMES: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini CLI', copilot: 'GitHub Copilot' };

function checkIntegrations(root: string, localInstall: boolean): DoctorItem[] {
  const items: DoctorItem[] = [];
  const files = [...CONFIG_FILES];
  const hooksDir = join(root, '.github', 'hooks');
  if (existsSync(hooksDir)) {
    for (const name of readdirSync(hooksDir)) if (name.endsWith('.json')) files.push({ agent: 'copilot', file: `.github/hooks/${name}`, hooksKey: 'hooks' });
  }
  for (const cfg of files) {
    const text = safeRead(join(root, cfg.file));
    if (text === null) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      items.push({ status: 'warn', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file} is not plain JSON; Ubon could not inspect it` });
      continue;
    }
    if (cfg.agent === 'claude' && (data.enabledPlugins as Record<string, unknown> | undefined)?.['ubon@ubon'] === true) {
      items.push({ status: 'ok', subject: AGENT_NAMES.claude, detail: `Ubon plugin enabled in ${cfg.file}` });
    }
    const hooks = (data[cfg.hooksKey] ?? {}) as Record<string, unknown>;
    const events: string[] = [];
    const commands: string[] = [];
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entryRunsUbon(entry)) continue;
        events.push(event);
        commands.push(...collectCommands(entry));
      }
    }
    if (events.length === 0) continue;
    const adapter = adapterFor(cfg.agent);
    const unknown = events.filter((e) => !adapter?.events.includes(e));
    if (unknown.length > 0) items.push({ status: 'error', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file} registers Ubon for events it does not handle: ${unknown.join(', ')}` });
    const wanted = HOOK_SPECS[cfg.agent].map((s) => s.event);
    const missing = wanted.filter((e) => !events.includes(e));
    const stopEvents = ['Stop', 'stop', 'AfterAgent', 'agentStop'];
    if (missing.some((e) => stopEvents.includes(e))) items.push({ status: 'warn', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file} has no stop hook, so changes are not checked before the agent finishes` });
    else if (missing.length > 0) items.push({ status: 'warn', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file} does not register: ${missing.join(', ')}` });
    if (commands.some((c) => /--no-install\s+ubon/.test(c)) && !localInstall) {
      items.push({ status: 'error', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file} runs "npx --no-install ubon", but ubon is not installed in this project (npm install --save-dev ubon)` });
    }
    const pinned = commands.map((c) => /ubon@([\w.-]+)/.exec(c)?.[1]).filter((v): v is string => !!v);
    if (pinned.some((v) => v !== VERSION)) items.push({ status: 'info', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file} runs ubon@${[...new Set(pinned)].join(', ')}; this is ${VERSION}` });
    if (!items.some((i) => i.subject === AGENT_NAMES[cfg.agent] && i.status !== 'info')) {
      items.push({ status: 'ok', subject: AGENT_NAMES[cfg.agent], detail: `${cfg.file}: ${events.length} Ubon hooks` });
    }
  }
  return items;
}

function collectCommands(entry: unknown): string[] {
  if (!entry || typeof entry !== 'object') return [];
  const e = entry as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['command', 'bash', 'powershell']) {
    const value = e[key];
    if (typeof value === 'string' && isUbonCommand(value)) out.push(value);
  }
  if (Array.isArray(e.hooks)) for (const h of e.hooks) out.push(...collectCommands(h));
  return out;
}

function recentActivity(root: string): string[] {
  const out: string[] = [];
  for (const s of recentSessions(root, 5)) {
    const events = readEvents(root, s.id);
    if (events.length === 0) continue;
    const agent = events[0]?.agent ?? '?';
    const denied = events.filter((e) => e.decision === 'deny' || e.decision === 'ask').length;
    const blocked = events.filter((e) => e.decision === 'continue' || e.decision === 'feedback').length;
    const errors = events.filter((e) => e.decision === 'error').length;
    const last = events[events.length - 1];
    const unresolved = events.filter((e) => e.unresolved && e.unresolved.length > 0).at(-1)?.unresolved?.length ?? 0;
    const ago = formatAgo(Date.now() - s.modified.getTime());
    out.push(
      `${agent} session ${s.id.slice(0, 12)} (${ago}): ${events.length} events, ${denied} denied or asked, ${blocked} findings returned, ${errors} errors${unresolved ? `, ${unresolved} left unresolved` : ''}; last: ${last?.event} (${last?.decision})`,
    );
  }
  return out;
}

function formatAgo(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
