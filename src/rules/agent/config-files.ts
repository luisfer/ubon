import { posix } from 'node:path';
import { type HookAgent, AGENT_HOOK_EVENTS, ALL_HOOK_EVENTS } from '../../data/agent-events.ts';
import { type PathKey, isRecord, parseStructured } from '../../lang/structured.ts';
import { type TomlPath, parseToml } from '../../lang/toml.ts';
import { quoteForReparse } from '../../lang/shell.ts';

/**
 * Agent, editor, and package configuration files: which kind a path is, and
 * the hook commands, MCP servers, env blocks, and auto-run commands they hold,
 * each with its line.
 */

export type ConfigKind =
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-config'
  | 'cursor-hooks'
  | 'cursor-cli'
  | 'gemini-settings'
  | 'gemini-extension'
  | 'copilot-hooks'
  | 'copilot-settings'
  | 'plugin-hooks'
  | 'mcp'
  | 'vscode-mcp'
  | 'zed-settings'
  | 'opencode'
  | 'devcontainer'
  | 'vscode-tasks'
  | 'package-json';

const KINDS: Array<[ConfigKind, RegExp]> = [
  ['claude-settings', /(^|\/)\.claude\/settings(\.local)?\.json$/],
  ['codex-hooks', /(^|\/)\.codex\/hooks\.json$/],
  ['codex-config', /(^|\/)\.codex\/config\.toml$/],
  ['cursor-hooks', /(^|\/)\.cursor\/hooks\.json$/],
  ['cursor-cli', /(^|\/)\.cursor\/cli\.json$/],
  ['mcp', /(^|\/)\.cursor\/mcp\.json$/],
  ['gemini-settings', /(^|\/)\.gemini\/settings\.json$/],
  ['gemini-extension', /(^|\/)gemini-extension\.json$/],
  ['copilot-hooks', /(^|\/)\.github\/hooks\/[^/]+\.json$/],
  ['copilot-settings', /(^|\/)\.github\/copilot\/settings(\.local)?\.json$/],
  ['vscode-mcp', /(^|\/)\.vscode\/mcp\.json$/],
  ['vscode-tasks', /(^|\/)\.vscode\/tasks\.json$/],
  ['zed-settings', /(^|\/)\.zed\/settings\.json$/],
  ['opencode', /(^|\/)opencode\.jsonc?$/],
  ['devcontainer', /(^|\/)\.devcontainer(\/[^/]+)?\/devcontainer\.json$|(^|\/)\.devcontainer\.json$/],
  ['plugin-hooks', /(^|\/)hooks\/hooks\.json$/],
  ['mcp', /(^|\/)(\.mcp|mcp|mcp_config|cline_mcp_settings|claude_desktop_config)\.json$/],
  ['package-json', /(^|\/)package\.json$/],
];

export function configKind(path: string): ConfigKind | null {
  if (/(^|\/)node_modules\//.test(path)) return null;
  for (const [kind, re] of KINDS) if (re.test(path)) return kind;
  return null;
}

export const HOOK_KINDS: ReadonlySet<ConfigKind> = new Set([
  'claude-settings',
  'codex-hooks',
  'codex-config',
  'cursor-hooks',
  'gemini-settings',
  'copilot-hooks',
  'copilot-settings',
  'plugin-hooks',
]);

export const MCP_KINDS: ReadonlySet<ConfigKind> = new Set([
  'mcp',
  'vscode-mcp',
  'gemini-settings',
  'gemini-extension',
  'codex-config',
  'zed-settings',
  'opencode',
]);

/** A parsed JSON, JSONC, or TOML document with line lookups. */
export interface ConfigDoc {
  kind: ConfigKind;
  path: string;
  data: unknown;
  ok: boolean;
  lineOf(path: readonly PathKey[]): number | null;
  valueLineOf(path: readonly PathKey[]): number | null;
}

export function parseConfig(path: string, text: string, kind: ConfigKind | null = configKind(path)): ConfigDoc | null {
  if (!kind) return null;
  if (kind === 'codex-config') {
    const doc = parseToml(text);
    const lineOf = (p: readonly PathKey[]) => doc.lineOf(p as TomlPath);
    return { kind, path, data: doc.data, ok: doc.errors.length === 0, lineOf, valueLineOf: lineOf };
  }
  const doc = parseStructured(text, 'json');
  return { kind, path, data: doc.data, ok: doc.data !== undefined, lineOf: doc.lineOf, valueLineOf: doc.valueLineOf };
}

export function at(data: unknown, path: readonly PathKey[]): unknown {
  let node = data;
  for (const key of path) {
    if (Array.isArray(node) && typeof key === 'number') node = node[key];
    else if (isRecord(node) && typeof key === 'string' && Object.hasOwn(node, key)) node = node[key];
    else return undefined;
  }
  return node;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function line(doc: ConfigDoc, path: readonly PathKey[]): number {
  return doc.lineOf(path) ?? doc.lineOf(path.slice(0, -1)) ?? 1;
}

// ---------------------------------------------------------------------------
// Hooks

export interface HookCommand {
  /** Field the command came from: command, bash, powershell, commandWindows, windows, linux, osx, exec. */
  field: string;
  text: string;
  dialect: 'sh' | 'powershell';
  line: number;
}

export interface HookHandler {
  event: string;
  eventLine: number;
  matcher: string | null;
  /** command (default), http, prompt, agent, mcp_tool. */
  type: string;
  commands: HookCommand[];
  url: string | null;
  line: number;
  /** Path to the handler object. */
  path: PathKey[];
  /** Env block on the handler (Copilot hooks), as [key, value, path]. */
  env: Array<{ key: string; value: string; path: PathKey[] }>;
}

export interface HookSection {
  /** Whose event names apply. */
  agents: HookAgent[] | 'any';
  /** Path to the object that maps event names to arrays. */
  path: PathKey[];
  events: Array<{ name: string; line: number }>;
  handlers: HookHandler[];
}

/** Agents whose event names apply to a hook file. Plugin hook files take the agent of the manifest next to them. */
export function hookAgents(doc: ConfigDoc, projectFiles: readonly string[] = []): HookAgent[] | 'any' {
  switch (doc.kind) {
    case 'claude-settings':
      return ['claude'];
    case 'codex-hooks':
    case 'codex-config':
      return ['codex'];
    case 'cursor-hooks':
      return ['cursor'];
    case 'gemini-settings':
      return ['gemini'];
    case 'copilot-hooks':
    case 'copilot-settings':
      return ['copilot'];
    case 'plugin-hooks': {
      const pluginRoot = posix.dirname(posix.dirname(doc.path));
      const prefix = pluginRoot === '.' ? '' : `${pluginRoot}/`;
      const has = (rel: string) => projectFiles.includes(`${prefix}${rel}`);
      const agents: HookAgent[] = [];
      if (has('.claude-plugin/plugin.json')) agents.push('claude');
      if (has('.codex-plugin/plugin.json')) agents.push('codex');
      if (has('.cursor-plugin/plugin.json')) agents.push('cursor');
      if (has('gemini-extension.json')) agents.push('gemini');
      if (has('.github/plugin/plugin.json') || has('plugin.json')) return 'any';
      return agents.length > 0 ? agents : 'any';
    }
    default:
      return 'any';
  }
}

export function eventAllowed(name: string, agents: HookAgent[] | 'any'): boolean {
  if (agents === 'any') return ALL_HOOK_EVENTS.has(name);
  return agents.some((a) => AGENT_HOOK_EVENTS[a].events.includes(name));
}

/** The hooks section of a config document, or null when the file has none. */
export function hookSection(doc: ConfigDoc, projectFiles: readonly string[] = []): HookSection | null {
  if (!HOOK_KINDS.has(doc.kind)) return null;
  const base: PathKey[] = ['hooks'];
  const hooks = at(doc.data, base);
  if (!isRecord(hooks)) return null;
  const agents = hookAgents(doc, projectFiles);
  const events: HookSection['events'] = [];
  const handlers: HookHandler[] = [];
  for (const [name, list] of Object.entries(hooks)) {
    // Codex config.toml keeps trust state next to the events.
    if (doc.kind === 'codex-config' && name === 'state') continue;
    const eventPath = [...base, name];
    const eventLine = line(doc, eventPath);
    events.push({ name, line: eventLine });
    if (!Array.isArray(list)) continue;
    list.forEach((item, i) => {
      if (!isRecord(item)) return;
      const itemPath = [...eventPath, i];
      if (Array.isArray(item.hooks)) {
        const matcher = str(item.matcher);
        item.hooks.forEach((h, j) => {
          if (isRecord(h)) handlers.push(readHandler(doc, name, eventLine, matcher, h, [...itemPath, 'hooks', j]));
        });
      } else {
        handlers.push(readHandler(doc, name, eventLine, str(item.matcher), item, itemPath));
      }
    });
  }
  return { agents, path: base, events, handlers };
}

const COMMAND_FIELDS: Array<[string, 'sh' | 'powershell']> = [
  ['command', 'sh'],
  ['bash', 'sh'],
  ['linux', 'sh'],
  ['osx', 'sh'],
  ['powershell', 'powershell'],
  ['windows', 'powershell'],
  ['commandWindows', 'powershell'],
];

function readHandler(doc: ConfigDoc, event: string, eventLine: number, matcher: string | null, h: Record<string, unknown>, path: PathKey[]): HookHandler {
  const type = str(h.type) ?? 'command';
  const commands: HookCommand[] = [];
  const shell = str(h.shell);
  const args = Array.isArray(h.args) ? h.args.filter((a): a is string => typeof a === 'string') : null;
  for (const [field, dialect] of COMMAND_FIELDS) {
    const value = str(h[field]);
    if (value === null || !value.trim()) continue;
    let text = value;
    // Exec form: the command is an executable and args are its arguments, with no shell.
    if (field === 'command' && args) text = [value, ...args].map(quoteForReparse).join(' ');
    const d = field === 'command' && shell === 'powershell' ? 'powershell' : dialect;
    commands.push({ field, text, dialect: d, line: line(doc, [...path, field]) });
  }
  const exec = str(h.exec);
  if (exec) commands.push({ field: 'exec', text: [exec, ...(args ?? [])].map(quoteForReparse).join(' '), dialect: 'sh', line: line(doc, [...path, 'exec']) });
  const env: HookHandler['env'] = [];
  if (isRecord(h.env)) {
    for (const [key, value] of Object.entries(h.env)) if (typeof value === 'string') env.push({ key, value, path: [...path, 'env', key] });
  }
  return {
    event,
    eventLine,
    matcher,
    type,
    commands,
    url: str(h.url),
    line: commands[0]?.line ?? (typeof h.url === 'string' ? line(doc, [...path, 'url']) : line(doc, path)),
    path,
    env,
  };
}

// ---------------------------------------------------------------------------
// MCP servers

export interface KeyValue {
  key: string;
  value: string;
  path: PathKey[];
}

export interface McpServer {
  name: string;
  path: PathKey[];
  line: number;
  command: string | null;
  args: string[];
  /** Line of the command (or of the server when unknown). */
  commandLine: number;
  url: string | null;
  urlPath: PathKey[] | null;
  urlLine: number;
  env: KeyValue[];
  headers: KeyValue[];
  /** Other fields that hold a credential directly (Codex bearer_token). */
  secrets: KeyValue[];
  /** Arguments with their paths, for secrets passed on the command line. */
  argPaths: PathKey[][];
}

function kv(obj: unknown, path: PathKey[]): KeyValue[] {
  if (!isRecord(obj)) return [];
  const out: KeyValue[] = [];
  for (const [key, value] of Object.entries(obj)) if (typeof value === 'string') out.push({ key, value, path: [...path, key] });
  return out;
}

export function mcpServers(doc: ConfigDoc): McpServer[] {
  const data = doc.data;
  let base: PathKey[];
  switch (doc.kind) {
    case 'vscode-mcp':
      base = ['servers'];
      break;
    case 'codex-config':
      base = ['mcp_servers'];
      break;
    case 'zed-settings':
      base = ['context_servers'];
      break;
    case 'opencode':
      base = ['mcp'];
      break;
    case 'mcp':
    case 'gemini-settings':
    case 'gemini-extension':
      base = isRecord(at(data, ['mcpServers'])) ? ['mcpServers'] : ['servers'];
      break;
    default:
      return [];
  }
  const servers = at(data, base);
  if (!isRecord(servers)) return [];
  const out: McpServer[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (!isRecord(raw)) continue;
    const path = [...base, name];
    let command: string | null = null;
    let args: string[] = [];
    let commandPath: PathKey[] = [...path, 'command'];
    let argPaths: PathKey[][] = [];
    if (Array.isArray(raw.command)) {
      // opencode: "command": ["npx", "-y", "pkg"]
      const parts = raw.command.filter((a): a is string => typeof a === 'string');
      command = parts[0] ?? null;
      args = parts.slice(1);
      argPaths = args.map((_, i) => [...path, 'command', i + 1]);
    } else if (isRecord(raw.command)) {
      // Zed: "command": { "path": "npx", "args": [...], "env": {...} }
      command = str(raw.command.path);
      commandPath = [...path, 'command', 'path'];
      if (Array.isArray(raw.command.args)) {
        args = raw.command.args.filter((a): a is string => typeof a === 'string');
        argPaths = args.map((_, i) => [...path, 'command', 'args', i]);
      }
    } else {
      command = str(raw.command);
      if (Array.isArray(raw.args)) {
        args = raw.args.filter((a): a is string => typeof a === 'string');
        argPaths = args.map((_, i) => [...path, 'args', i]);
      }
    }
    const urlKey = ['url', 'serverUrl', 'httpUrl'].find((k) => typeof raw[k] === 'string');
    const env = [
      ...kv(raw.env, [...path, 'env']),
      ...kv(raw.environment, [...path, 'environment']),
      ...(isRecord(raw.command) ? kv(raw.command.env, [...path, 'command', 'env']) : []),
    ];
    const headers = [...kv(raw.headers, [...path, 'headers']), ...kv(raw.http_headers, [...path, 'http_headers'])];
    const secrets: KeyValue[] = [];
    if (typeof raw.bearer_token === 'string') secrets.push({ key: 'bearer_token', value: raw.bearer_token, path: [...path, 'bearer_token'] });
    out.push({
      name,
      path,
      line: line(doc, path),
      command,
      args,
      commandLine: command ? line(doc, commandPath) : line(doc, path),
      url: urlKey ? (raw[urlKey] as string) : null,
      urlPath: urlKey ? [...path, urlKey] : null,
      urlLine: urlKey ? line(doc, [...path, urlKey]) : line(doc, path),
      env,
      headers,
      secrets,
      argPaths,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auto-run entries: code that runs when an agent or editor opens the project

export interface AutorunEntry {
  /** Stable identity for comparing base and current versions. */
  id: string;
  /** Where it runs, for messages: `PreToolUse hook`, `postCreateCommand`, `postinstall script`. */
  label: string;
  command: string;
  dialect: 'sh' | 'powershell';
  line: number;
  /** Hooks that post events to a URL. */
  url?: string;
}

const DEVCONTAINER_KEYS = ['initializeCommand', 'onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand', 'postAttachCommand'];
export const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare'];

function commandValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return (value as string[]).map(quoteForReparse).join(' ');
  return null;
}

export function autorunEntries(doc: ConfigDoc, projectFiles: readonly string[] = []): AutorunEntry[] {
  const out: AutorunEntry[] = [];
  if (HOOK_KINDS.has(doc.kind)) {
    const section = hookSection(doc, projectFiles);
    for (const h of section?.handlers ?? []) {
      const label = `${h.event} hook`;
      for (const c of h.commands) out.push({ id: `hook:${h.event}:${c.field}:${c.text}`, label, command: c.text, dialect: c.dialect, line: c.line });
      if (h.commands.length === 0 && h.url) out.push({ id: `hook:${h.event}:url:${h.url}`, label, command: '', dialect: 'sh', line: h.line, url: h.url });
    }
    return out;
  }
  if (doc.kind === 'devcontainer') {
    for (const key of DEVCONTAINER_KEYS) {
      const value = at(doc.data, [key]);
      if (isRecord(value)) {
        for (const [name, v] of Object.entries(value)) {
          const command = commandValue(v);
          if (command) out.push({ id: `devcontainer:${key}:${name}:${command}`, label: `${key} (${name})`, command, dialect: 'sh', line: line(doc, [key, name]) });
        }
        continue;
      }
      const command = commandValue(value);
      if (command) out.push({ id: `devcontainer:${key}:${command}`, label: key, command, dialect: 'sh', line: line(doc, [key]) });
    }
    return out;
  }
  if (doc.kind === 'vscode-tasks') {
    const tasks = at(doc.data, ['tasks']);
    if (!Array.isArray(tasks)) return out;
    tasks.forEach((task, i) => {
      if (!isRecord(task)) return;
      const runOn = at(task, ['runOptions', 'runOn']);
      if (runOn !== 'folderOpen') return;
      const base = commandValue(task.command) ?? '';
      const args = Array.isArray(task.args) ? task.args.filter((a): a is string => typeof a === 'string').map(quoteForReparse) : [];
      const command = [base, ...args].filter(Boolean).join(' ');
      const name = str(task.label) ?? str(task.taskName) ?? `#${i + 1}`;
      out.push({ id: `task:${name}:${command}`, label: `task "${name}"`, command, dialect: 'sh', line: line(doc, ['tasks', i, 'runOptions', 'runOn']) });
    });
    return out;
  }
  if (doc.kind === 'package-json') {
    const scripts = at(doc.data, ['scripts']);
    if (!isRecord(scripts)) return out;
    for (const name of INSTALL_SCRIPTS) {
      const command = str(scripts[name]);
      if (command) out.push({ id: `script:${name}:${command}`, label: `${name} script`, command, dialect: 'sh', line: line(doc, ['scripts', name]) });
    }
  }
  return out;
}

/** Every shell command string a config file runs (hooks, scripts, lifecycle commands), for command-level checks. */
export interface ConfigCommand {
  label: string;
  command: string;
  dialect: 'sh' | 'powershell';
  line: number;
  /** True when the command runs without a person starting it (hooks, install scripts, lifecycle commands). */
  automatic: boolean;
}

export function configCommands(doc: ConfigDoc, projectFiles: readonly string[] = []): ConfigCommand[] {
  if (doc.kind === 'package-json') {
    const scripts = at(doc.data, ['scripts']);
    if (!isRecord(scripts)) return [];
    const out: ConfigCommand[] = [];
    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value !== 'string') continue;
      out.push({ label: `script "${name}"`, command: value, dialect: 'sh', line: line(doc, ['scripts', name]), automatic: INSTALL_SCRIPTS.includes(name) });
    }
    return out;
  }
  return autorunEntries(doc, projectFiles)
    .filter((e) => e.command)
    .map((e) => ({ label: e.label, command: e.command, dialect: e.dialect, line: e.line, automatic: true }));
}
