import type { Adapter, HookContext, HookDecision, HookEvent, HookOutput, ToolAction } from '../types.ts';
import { json, obj, outputText, str } from '../types.ts';

/**
 * Claude Code. Payloads are snake_case; outputs use hookSpecificOutput for
 * PreToolUse, PostToolUse context, and SessionStart, and top-level
 * decision/reason for blocks. Claude Code ignores unknown fields, so the
 * PreToolUse output also carries top-level permissionDecision fields for
 * GitHub Copilot CLI, which reads .claude/settings.json too.
 * Reference: https://code.claude.com/docs/en/hooks
 */

export function claudeToolAction(tool: string, input: Record<string, unknown>): ToolAction {
  switch (tool) {
    case 'Bash':
      return { type: 'shell', command: str(input.command) ?? '', shell: 'bash' };
    case 'PowerShell':
      return { type: 'shell', command: str(input.command) ?? '', shell: 'powershell' };
    case 'Read':
      return { type: 'read', paths: [str(input.file_path)].filter((p): p is string => !!p) };
    case 'Write': {
      const path = str(input.file_path);
      return path ? { type: 'write', files: [{ path, content: str(input.content) ?? '' }] } : { type: 'other', name: tool };
    }
    case 'Edit': {
      const path = str(input.file_path);
      return path ? { type: 'write', files: [{ path, added: str(input.new_string) ?? '' }] } : { type: 'other', name: tool };
    }
    case 'MultiEdit': {
      const path = str(input.file_path);
      const edits = Array.isArray(input.edits) ? input.edits : [];
      const added = edits.map((e) => str(obj(e).new_string) ?? '').join('\n');
      return path ? { type: 'write', files: [{ path, added }] } : { type: 'other', name: tool };
    }
    case 'NotebookEdit': {
      const path = str(input.notebook_path);
      return path ? { type: 'write', files: [{ path, added: str(input.new_source) ?? '' }] } : { type: 'other', name: tool };
    }
    default:
      return { type: 'other', name: tool };
  }
}

export const claude: Adapter = {
  agent: 'claude',
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
        parsed = { kind: 'pre-tool', tool, action: claudeToolAction(tool, input) };
        break;
      case 'PostToolUse':
        parsed = { kind: 'post-tool', tool, action: claudeToolAction(tool, input), output: outputText(payload.tool_response) };
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
  format(event: HookEvent, decision: HookDecision, ctx: HookContext): HookOutput {
    const notice = 'notice' in decision && decision.notice ? { systemMessage: decision.notice } : {};
    switch (decision.type) {
      case 'allow':
        return { stdout: decision.notice ? json(notice) : '', exitCode: 0 };
      case 'context':
        if (ctx.event === 'Stop' || ctx.event === 'UserPromptSubmit') {
          // No model-visible context channel that does not block; show it to the user.
          return { stdout: json({ systemMessage: decision.notice ?? decision.text }), exitCode: 0 };
        }
        return { stdout: json({ ...notice, hookSpecificOutput: { hookEventName: ctx.event, additionalContext: decision.text } }), exitCode: 0 };
      case 'deny':
      case 'ask': {
        const verdict = decision.type;
        return {
          stdout: json({
            hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict, permissionDecisionReason: decision.reason },
            permissionDecision: verdict,
            permissionDecisionReason: decision.reason,
          }),
          exitCode: 0,
        };
      }
      case 'feedback':
      case 'continue':
        return { stdout: json({ decision: 'block', reason: decision.reason }), exitCode: 0 };
      case 'block-prompt':
        return { stdout: json({ decision: 'block', reason: decision.message }), exitCode: 0 };
    }
    void event;
    return { stdout: '', exitCode: 0 };
  },
  failOpen(_event, notice) {
    return { stdout: json({ systemMessage: notice }), exitCode: 0 };
  },
};
