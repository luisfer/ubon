import { isApplyPatch, parseApplyPatch } from '../patch.ts';
import type { Adapter, HookContext, HookDecision, HookEvent, HookOutput, ToolAction } from '../types.ts';
import { json, obj, outputText, str } from '../types.ts';

/**
 * Codex. Same payload shape as Claude Code, but outputs are validated
 * strictly: one unknown or misplaced field makes Codex discard the whole
 * output and run the tool unhooked. Every output below uses only documented
 * fields for its event. PreToolUse has no "ask", so ask becomes deny with
 * instructions for the person. File edits arrive as apply_patch envelopes.
 * Reference: https://developers.openai.com/codex/hooks
 */

function codexToolAction(tool: string, input: Record<string, unknown>): ToolAction {
  if (tool === 'Bash' || tool === 'shell' || tool === 'exec_command') {
    const command = str(input.command) ?? (Array.isArray(input.command) ? (input.command as unknown[]).map(String).join(' ') : '');
    return { type: 'shell', command, shell: 'bash' };
  }
  if (tool === 'apply_patch' || tool === 'Edit' || tool === 'Write') {
    const text = str(input.command) ?? str(input.input) ?? str(input.patch) ?? '';
    if (isApplyPatch(text)) return { type: 'write', files: parseApplyPatch(text) };
    return { type: 'other', name: tool };
  }
  return { type: 'other', name: tool };
}

export const codex: Adapter = {
  agent: 'codex',
  events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'],
  parse(event, payload, cwd) {
    const ctx = {
      sessionId: str(payload.session_id) ?? '',
      cwd: str(payload.cwd) || cwd,
      ...(str(payload.tool_use_id) ? { toolUseId: str(payload.tool_use_id) } : {}),
    };
    const tool = str(payload.tool_name) ?? '';
    const input = obj(payload.tool_input);
    let parsed: HookEvent;
    switch (event) {
      case 'SessionStart':
        parsed = { kind: 'session-start', source: str(payload.source) };
        break;
      case 'UserPromptSubmit':
        parsed = { kind: 'prompt', prompt: str(payload.prompt) ?? '' };
        break;
      case 'PreToolUse':
        parsed = { kind: 'pre-tool', tool, action: codexToolAction(tool, input) };
        break;
      case 'PostToolUse':
        parsed = { kind: 'post-tool', tool, action: codexToolAction(tool, input), output: outputText(payload.tool_response) };
        break;
      case 'Stop':
      case 'SubagentStop':
        parsed = { kind: 'stop', subagent: event === 'SubagentStop', stopHookActive: payload.stop_hook_active === true };
        break;
      default:
        parsed = { kind: 'ignore', why: `event ${event} is not handled` };
    }
    return { ctx, event: parsed };
  },
  format(_event: HookEvent, decision: HookDecision, ctx: HookContext): HookOutput {
    const event = ctx.event;
    const notice = 'notice' in decision && decision.notice ? { systemMessage: decision.notice } : {};
    switch (decision.type) {
      case 'allow':
        return { stdout: decision.notice ? json(notice) : '', exitCode: 0 };
      case 'context':
        if (event === 'Stop' || event === 'SubagentStop') return { stdout: json({ systemMessage: decision.notice ?? decision.text }), exitCode: 0 };
        return { stdout: json({ ...notice, hookSpecificOutput: { hookEventName: event, additionalContext: decision.text } }), exitCode: 0 };
      case 'deny':
      case 'ask':
        return {
          stdout: json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }),
          exitCode: 0,
        };
      case 'feedback':
      case 'continue':
        return { stdout: json({ decision: 'block', reason: decision.reason }), exitCode: 0 };
      case 'block-prompt':
        return { stdout: json({ decision: 'block', reason: decision.message }), exitCode: 0 };
    }
    return { stdout: '', exitCode: 0 };
  },
  failOpen(_event, notice) {
    return { stdout: json({ systemMessage: notice }), exitCode: 0 };
  },
};
