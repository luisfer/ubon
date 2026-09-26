import { isApplyPatch, parseApplyPatch } from '../patch.ts';
import type { Adapter, HookContext, HookDecision, HookEvent, HookOutput, ToolAction } from '../types.ts';
import { json, obj, outputText, str } from '../types.ts';
import { claudeToolAction } from './claude.ts';

/**
 * GitHub Copilot: the CLI, the cloud agent, and VS Code.
 *
 * - PascalCase events (SessionStart, PreToolUse, ...) deliver snake_case
 *   payloads with Claude tool names in the CLI, and VS Code tool names
 *   (run_in_terminal, read_file, ...) in VS Code. camelCase events deliver
 *   camelCase payloads with toolArgs as a JSON string. Both are accepted.
 * - The CLI reads top-level fields; VS Code reads hookSpecificOutput. Every
 *   output carries both.
 * - A crashing preToolUse command hook denies the tool call, so Ubon always
 *   exits 0.
 * - userPromptSubmitted output is dropped by the CLI, so prompts can only be
 *   blocked in VS Code.
 * Reference: https://docs.github.com/en/copilot/reference/hooks-reference
 */

function pathOf(input: Record<string, unknown>): string | undefined {
  return str(input.filePath) ?? str(input.file_path) ?? str(input.path);
}

function copilotToolAction(tool: string, input: Record<string, unknown>): ToolAction {
  const path = pathOf(input);
  const patchText = str(input.input) ?? str(input.patch) ?? str(input.command) ?? '';
  switch (tool) {
    case 'Bash':
    case 'bash':
    case 'run_in_terminal':
      return { type: 'shell', command: str(input.command) ?? '', shell: 'bash' };
    case 'PowerShell':
    case 'powershell':
      return { type: 'shell', command: str(input.command) ?? '', shell: 'powershell' };
    case 'Read':
    case 'view':
    case 'read_file':
      return path ? { type: 'read', paths: [path] } : { type: 'other', name: tool };
    case 'Write':
    case 'create':
    case 'create_file':
      return path ? { type: 'write', files: [{ path, content: str(input.file_text) ?? str(input.content) ?? '' }] } : { type: 'other', name: tool };
    case 'apply_patch':
    case 'Edit':
    case 'MultiEdit':
    case 'edit':
    case 'str_replace_editor':
    case 'replace_string_in_file':
    case 'insert_edit_into_file': {
      // Copilot reports apply_patch as "Edit" under Claude tool names.
      if (isApplyPatch(patchText)) return { type: 'write', files: parseApplyPatch(patchText) };
      if (!path) return { type: 'other', name: tool };
      const added = str(input.new_str) ?? str(input.newString) ?? str(input.new_string) ?? str(input.code) ?? str(input.file_text) ?? '';
      return { type: 'write', files: [{ path, added }] };
    }
    case 'NotebookEdit':
      return claudeToolAction(tool, input);
    default:
      return { type: 'other', name: tool };
  }
}

function resultText(payload: Record<string, unknown>): string {
  if (payload.tool_response !== undefined) return outputText(payload.tool_response);
  const snake = obj(payload.tool_result);
  if (typeof snake.text_result_for_llm === 'string') return snake.text_result_for_llm;
  const camel = obj(payload.toolResult);
  if (typeof camel.textResultForLlm === 'string') return camel.textResultForLlm;
  return '';
}

const PRE = new Set(['PreToolUse', 'preToolUse']);
const POST = new Set(['PostToolUse', 'postToolUse']);
const STOP = new Set(['Stop', 'agentStop']);
const SUBAGENT_STOP = new Set(['SubagentStop', 'subagentStop']);

export const copilot: Adapter = {
  agent: 'copilot',
  events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'agentStop', 'subagentStop'],
  parse(event, payload, cwd) {
    const ctx = {
      sessionId: str(payload.session_id) ?? str(payload.sessionId) ?? '',
      cwd: str(payload.cwd) || cwd,
      ...(str(payload.tool_use_id) ? { toolUseId: str(payload.tool_use_id) } : {}),
    };
    const tool = str(payload.tool_name) ?? str(payload.toolName) ?? '';
    const input = payload.tool_input !== undefined ? obj(payload.tool_input) : obj(payload.toolArgs);
    let parsed: HookEvent;
    if (event === 'SessionStart' || event === 'sessionStart') parsed = { kind: 'session-start', source: str(payload.source) };
    else if (event === 'UserPromptSubmit' || event === 'userPromptSubmitted') parsed = { kind: 'prompt', prompt: str(payload.prompt) ?? '' };
    else if (PRE.has(event)) parsed = { kind: 'pre-tool', tool, action: copilotToolAction(tool, input) };
    else if (POST.has(event)) parsed = { kind: 'post-tool', tool, action: copilotToolAction(tool, input), output: resultText(payload) };
    else if (STOP.has(event) || SUBAGENT_STOP.has(event)) {
      parsed = { kind: 'stop', subagent: SUBAGENT_STOP.has(event), stopHookActive: payload.stop_hook_active === true || payload.stopHookActive === true };
    } else parsed = { kind: 'ignore', why: `event ${event} is not handled` };
    return { ctx, event: parsed };
  },
  format(_event: HookEvent, decision: HookDecision, ctx: HookContext): HookOutput {
    const event = ctx.event;
    const pascal = /^[A-Z]/.test(event);
    const hookEventName = pascal ? event : event === 'agentStop' ? 'Stop' : event.charAt(0).toUpperCase() + event.slice(1);
    const notice = 'notice' in decision && decision.notice ? { systemMessage: decision.notice } : {};
    switch (decision.type) {
      case 'allow':
        return { stdout: decision.notice ? json(notice) : '', exitCode: 0 };
      case 'context':
        if (STOP.has(event) || SUBAGENT_STOP.has(event)) return { stdout: json({ systemMessage: decision.notice ?? decision.text }), exitCode: 0 };
        return { stdout: json({ ...notice, additionalContext: decision.text, hookSpecificOutput: { hookEventName, additionalContext: decision.text } }), exitCode: 0 };
      case 'deny':
      case 'ask':
        return {
          stdout: json({
            permissionDecision: decision.type,
            permissionDecisionReason: decision.reason,
            hookSpecificOutput: { hookEventName, permissionDecision: decision.type, permissionDecisionReason: decision.reason },
          }),
          exitCode: 0,
        };
      case 'feedback':
        return { stdout: json({ additionalContext: decision.reason, hookSpecificOutput: { hookEventName, additionalContext: decision.reason } }), exitCode: 0 };
      case 'continue':
        if (SUBAGENT_STOP.has(event)) return { stdout: json({ decision: 'block', reason: decision.reason }), exitCode: 0 };
        return { stdout: json({ decision: 'block', reason: decision.reason, hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason: decision.reason } }), exitCode: 0 };
      case 'block-prompt':
        return { stdout: json({ decision: 'block', reason: decision.message, systemMessage: decision.message }), exitCode: 0 };
    }
    return { stdout: '', exitCode: 0 };
  },
  failOpen(_event, notice) {
    return { stdout: json({ systemMessage: notice }), exitCode: 0 };
  },
};
