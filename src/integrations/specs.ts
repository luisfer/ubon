import type { AgentId } from '../hook/types.ts';

/**
 * One source for every agent's hook registration. `ubon init` writes these
 * into project config files, the Claude Code plugin's hooks/hooks.json is
 * generated from the same data, and `ubon doctor` compares installed files
 * against them.
 */

export interface HookSpec {
  /** Event name as the agent's config spells it. */
  event: string;
  /** Tool matcher, when the agent supports one for this event. */
  matcher?: string;
  /** Timeout in seconds. */
  timeout: number;
  statusMessage?: string;
}

export const HOOK_SPECS: Record<AgentId, HookSpec[]> = {
  claude: [
    { event: 'SessionStart', timeout: 10 },
    { event: 'UserPromptSubmit', timeout: 5 },
    { event: 'PreToolUse', matcher: 'Bash|PowerShell|Read|Edit|Write|NotebookEdit', timeout: 10 },
    { event: 'PostToolUse', matcher: 'Edit|Write|NotebookEdit|Bash|PowerShell', timeout: 30, statusMessage: 'ubon: checking the change' },
    { event: 'Stop', timeout: 120, statusMessage: "ubon: checking this session's changes" },
    { event: 'SubagentStop', timeout: 120 },
  ],
  codex: [
    { event: 'SessionStart', timeout: 10 },
    { event: 'UserPromptSubmit', timeout: 5 },
    { event: 'PreToolUse', matcher: 'Bash|apply_patch', timeout: 10 },
    { event: 'PostToolUse', matcher: 'Bash|apply_patch', timeout: 60 },
    { event: 'Stop', timeout: 120 },
  ],
  cursor: [
    { event: 'sessionStart', timeout: 10 },
    { event: 'beforeSubmitPrompt', timeout: 5 },
    { event: 'beforeShellExecution', timeout: 10 },
    { event: 'beforeReadFile', timeout: 5 },
    { event: 'preToolUse', matcher: 'Write', timeout: 10 },
    { event: 'postToolUse', matcher: 'Write|Shell', timeout: 30 },
    { event: 'stop', timeout: 120 },
  ],
  gemini: [
    { event: 'SessionStart', timeout: 10 },
    { event: 'BeforeAgent', timeout: 5 },
    { event: 'BeforeTool', matcher: 'run_shell_command|read_file|read_many_files|write_file|replace', timeout: 10 },
    { event: 'AfterTool', matcher: 'write_file|replace|run_shell_command', timeout: 30 },
    { event: 'AfterAgent', timeout: 120 },
  ],
  copilot: [
    { event: 'SessionStart', timeout: 10 },
    { event: 'PreToolUse', timeout: 10 },
    { event: 'PostToolUse', timeout: 30 },
    { event: 'Stop', timeout: 120 },
    { event: 'SubagentStop', timeout: 120 },
  ],
};

/** How hooks start Ubon: the project's own install, or a pinned download. Never an unpinned `npx ubon`. */
export function launcherFor(localInstall: boolean, version: string): string {
  return localInstall ? 'npx --no-install ubon' : `npx -y ubon@${version}`;
}

export function hookCommand(launcher: string, agent: AgentId, event: string): string {
  return `${launcher} hook ${agent} ${event}`;
}

/** True for a hook command that runs Ubon (any launcher). */
export function isUbonCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return /(^|[\s/\\"'])ubon(\.mjs)?(@[\w.-]+)?["']?\s+hook\s/.test(command) || /dist[\\/]ubon\.mjs["']?\s*$/.test(command);
}

// ---------------------------------------------------------------------------
// Per-agent config shapes

export function claudeHooks(launcher: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of HOOK_SPECS.claude) {
    const hook: Record<string, unknown> = { type: 'command', command: hookCommand(launcher, 'claude', spec.event), timeout: spec.timeout };
    if (spec.statusMessage) hook.statusMessage = spec.statusMessage;
    out[spec.event] = [{ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [hook] }];
  }
  return out;
}

/** hooks/hooks.json for the Claude Code plugin: runs the bundled file with node, in exec form. */
export function claudePluginHooks(): Record<string, unknown> {
  const hooks: Record<string, unknown[]> = {};
  for (const spec of HOOK_SPECS.claude) {
    const hook: Record<string, unknown> = {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs', 'hook', 'claude', spec.event],
      timeout: spec.timeout,
    };
    if (spec.statusMessage) hook.statusMessage = spec.statusMessage;
    hooks[spec.event] = [{ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [hook] }];
  }
  return { description: 'Ubon: deterministic checks on agent actions and changes', hooks };
}

export function codexHooks(launcher: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of HOOK_SPECS.codex) {
    const command = hookCommand(launcher, 'codex', spec.event);
    out[spec.event] = [{ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [{ type: 'command', command, commandWindows: command, timeout: spec.timeout }] }];
  }
  return out;
}

export function cursorHooks(launcher: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of HOOK_SPECS.cursor) {
    out[spec.event] = [{ command: hookCommand(launcher, 'cursor', spec.event), ...(spec.matcher ? { matcher: spec.matcher } : {}), timeout: spec.timeout, ...(spec.event === 'stop' ? { loop_limit: 3 } : {}) }];
  }
  return out;
}

export function geminiHooks(launcher: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of HOOK_SPECS.gemini) {
    // Gemini CLI timeouts are in milliseconds.
    out[spec.event] = [{ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [{ type: 'command', name: 'ubon', command: hookCommand(launcher, 'gemini', spec.event), timeout: spec.timeout * 1000 }] }];
  }
  return out;
}

export function copilotHooks(launcher: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of HOOK_SPECS.copilot) {
    const command = hookCommand(launcher, 'copilot', spec.event);
    out[spec.event] = [{ type: 'command', bash: command, powershell: command, timeoutSec: spec.timeout }];
  }
  return out;
}
