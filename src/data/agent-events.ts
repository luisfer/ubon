/**
 * Hook event names each agent defines. A hook registered under any other name
 * never runs, and most agents say nothing about it (Codex ignores unknown
 * event keys; Claude Code and Cursor skip them).
 *
 * Sources, checked on 2026-09-26:
 * - Claude Code: hooks reference, https://code.claude.com/docs/en/hooks
 *   ("Hook lifecycle" table, 33 events).
 * - Codex: codex-rs/config/src/hook_config.rs in openai/codex
 *   (HookEventsToml, the serde names of the `hooks` table).
 * - Cursor: https://cursor.com/docs/reference/hooks ("Hook events": agent,
 *   Tab, and app lifecycle hooks), as summarized in the rosetta project's
 *   harness notes (references/hooks/cursor.md), which also record live hook
 *   runs on Cursor 3.9.16.
 * - Gemini CLI: docs/hooks/index.md and docs/reference/configuration.md
 *   (`hooks.*` settings) in google-gemini/gemini-cli.
 * - GitHub Copilot CLI and cloud agent: docs.github.com
 *   copilot/reference/hooks-reference ("Hook events", camelCase names and the
 *   PascalCase VS Code compatible names).
 * - VS Code agent hooks: code.visualstudio.com/docs/agent-customization/hooks
 *   ("Local hook lifecycle events").
 *
 * Update these lists with each agent release; a missing new event produces a
 * warning, never a block.
 */

export type HookAgent = 'claude' | 'codex' | 'cursor' | 'gemini' | 'copilot';

export interface AgentHookEvents {
  /** Name used in messages. */
  label: string;
  events: readonly string[];
}

export const CLAUDE_EVENTS = [
  'SessionStart',
  'Setup',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'MessageDisplay',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'TeammateIdle',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'Elicitation',
  'ElicitationResult',
  'SessionEnd',
] as const;

export const CODEX_EVENTS = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
] as const;

export const CURSOR_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'subagentStart',
  'subagentStop',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeMCPExecution',
  'afterMCPExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeSubmitPrompt',
  'preCompact',
  'stop',
  'afterAgentResponse',
  'afterAgentThought',
  'beforeTabFileRead',
  'afterTabFileEdit',
  'workspaceOpen',
] as const;

export const GEMINI_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'BeforeAgent',
  'AfterAgent',
  'BeforeModel',
  'AfterModel',
  'BeforeToolSelection',
  'BeforeTool',
  'AfterTool',
  'PreCompress',
  'Notification',
] as const;

/** Copilot CLI and cloud agent native names (camelCase payloads). */
export const COPILOT_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmitted',
  'userPromptTransformed',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'permissionRequest',
  'agentStop',
  'subagentStart',
  'subagentStop',
  'errorOccurred',
  'preCompact',
  'notification',
] as const;

/** PascalCase names that Copilot CLI accepts (VS Code compatible payloads) and that VS Code uses natively. */
export const COPILOT_PASCAL_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'ErrorOccurred',
  'PreCompact',
] as const;

export const AGENT_HOOK_EVENTS: Record<HookAgent, AgentHookEvents> = {
  claude: { label: 'Claude Code', events: CLAUDE_EVENTS },
  codex: { label: 'Codex', events: CODEX_EVENTS },
  cursor: { label: 'Cursor', events: CURSOR_EVENTS },
  gemini: { label: 'Gemini CLI', events: GEMINI_EVENTS },
  copilot: { label: 'GitHub Copilot', events: [...COPILOT_EVENTS, ...COPILOT_PASCAL_EVENTS] },
};

/** Every event name any supported agent defines (for plugin hook files whose agent is unknown). */
export const ALL_HOOK_EVENTS: ReadonlySet<string> = new Set(Object.values(AGENT_HOOK_EVENTS).flatMap((a) => a.events));
