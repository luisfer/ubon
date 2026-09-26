import type { Adapter, HookContext, HookDecision, HookEvent, HookOutput, ToolAction } from '../types.ts';
import { json, obj, str } from '../types.ts';

/**
 * Cursor. Payloads and outputs are flat snake_case, with no
 * hookSpecificOutput wrapper. afterFileEdit cannot return anything, so edit
 * feedback goes through postToolUse on the Write tool. On a deny, the model
 * receives user_message (observed in Cursor 3.9), so the full explanation
 * goes into both user_message and agent_message. `ask` is documented for
 * beforeShellExecution but behaved like a silent deny in Cursor 3.9, so the
 * message always says how a person can allow the command.
 * Reference: https://cursor.com/docs/agent/hooks
 */

function cursorToolAction(tool: string, input: Record<string, unknown>): ToolAction {
  const path = str(input.file_path) ?? str(input.path) ?? str(input.target_file);
  switch (tool) {
    case 'Shell':
      return { type: 'shell', command: str(input.command) ?? '', shell: 'bash' };
    case 'Read':
      return path ? { type: 'read', paths: [path] } : { type: 'other', name: tool };
    case 'Write':
    case 'Edit':
    case 'MultiEdit': {
      if (!path) return { type: 'other', name: tool };
      const content = str(input.content) ?? str(input.contents) ?? str(input.file_text);
      const added = str(input.new_string) ?? str(input.code_edit) ?? str(input.streamingContent);
      return { type: 'write', files: [{ path, ...(content !== undefined ? { content } : {}), ...(added !== undefined ? { added } : {}) }] };
    }
    default:
      return { type: 'other', name: tool };
  }
}

function toolOutput(payload: Record<string, unknown>): string {
  const raw = payload.tool_output ?? payload.output;
  if (typeof raw !== 'string') return '';
  const parsed = obj(raw);
  return typeof parsed.output === 'string' ? parsed.output : raw;
}

export const cursor: Adapter = {
  agent: 'cursor',
  events: ['sessionStart', 'beforeSubmitPrompt', 'beforeShellExecution', 'beforeReadFile', 'preToolUse', 'postToolUse', 'afterShellExecution', 'stop'],
  parse(event, payload, cwd) {
    const roots = Array.isArray(payload.workspace_roots) ? (payload.workspace_roots as unknown[]).filter((r): r is string => typeof r === 'string') : [];
    const ctx = {
      sessionId: str(payload.session_id) ?? str(payload.conversation_id) ?? '',
      cwd: str(payload.cwd) || roots[0] || process.env.CURSOR_PROJECT_DIR || cwd,
      ...(str(payload.tool_use_id) ? { toolUseId: str(payload.tool_use_id) } : {}),
    };
    const tool = str(payload.tool_name) ?? '';
    const input = obj(payload.tool_input);
    let parsed: HookEvent;
    switch (event) {
      case 'sessionStart':
        parsed = { kind: 'session-start' };
        break;
      case 'beforeSubmitPrompt':
        parsed = { kind: 'prompt', prompt: str(payload.prompt) ?? '' };
        break;
      case 'beforeShellExecution':
        parsed = { kind: 'pre-tool', tool: 'Shell', action: { type: 'shell', command: str(payload.command) ?? '', shell: 'bash' } };
        break;
      case 'beforeReadFile': {
        const path = str(payload.file_path);
        parsed = path ? { kind: 'pre-tool', tool: 'Read', action: { type: 'read', paths: [path] } } : { kind: 'ignore', why: 'no file path' };
        break;
      }
      case 'preToolUse':
        parsed = { kind: 'pre-tool', tool, action: cursorToolAction(tool, input) };
        break;
      case 'postToolUse':
        parsed = { kind: 'post-tool', tool, action: cursorToolAction(tool, input), output: toolOutput(payload) };
        break;
      case 'afterShellExecution':
        parsed = { kind: 'post-tool', tool: 'Shell', action: { type: 'shell', command: str(payload.command) ?? '', shell: 'bash' }, output: str(payload.output) ?? '' };
        break;
      case 'stop': {
        const status = str(payload.status);
        const loops = typeof payload.loop_count === 'number' ? payload.loop_count : 0;
        parsed = { kind: 'stop', subagent: false, stopHookActive: loops > 0, ...(status ? { status } : {}) };
        break;
      }
      default:
        parsed = { kind: 'ignore', why: `event ${event} is not handled` };
    }
    return { ctx, event: parsed };
  },
  format(_event: HookEvent, decision: HookDecision, ctx: HookContext): HookOutput {
    switch (decision.type) {
      case 'allow':
        return { stdout: '', exitCode: 0, ...(decision.notice ? { stderr: `${decision.notice}\n` } : {}) };
      case 'context':
        if (ctx.event === 'stop' || ctx.event === 'beforeSubmitPrompt' || ctx.event === 'afterShellExecution') {
          return { stdout: '', exitCode: 0, stderr: `${decision.notice ?? decision.text}\n` };
        }
        return { stdout: json({ additional_context: decision.text }), exitCode: 0 };
      case 'deny':
      case 'ask': {
        const permission = decision.type === 'ask' && ctx.event === 'beforeShellExecution' ? 'ask' : 'deny';
        return { stdout: json({ permission, user_message: decision.reason, agent_message: decision.reason }), exitCode: 0 };
      }
      case 'feedback':
        if (ctx.event === 'afterShellExecution') return { stdout: '', exitCode: 0, stderr: `${decision.reason}\n` };
        return { stdout: json({ additional_context: decision.reason }), exitCode: 0 };
      case 'continue':
        return { stdout: json({ followup_message: decision.reason }), exitCode: 0 };
      case 'block-prompt':
        return { stdout: json({ continue: false, user_message: decision.message }), exitCode: 0 };
    }
    return { stdout: '', exitCode: 0 };
  },
  failOpen(_event, notice) {
    return { stdout: '', exitCode: 0, stderr: `${notice}\n` };
  },
};
