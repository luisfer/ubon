import type { Adapter, HookContext, HookDecision, HookEvent, HookOutput, ToolAction } from '../types.ts';
import { json, obj, str } from '../types.ts';

/**
 * Gemini CLI. Events are BeforeTool, AfterTool, BeforeAgent, AfterAgent, and
 * SessionStart; decisions use `decision: "deny"` with `reason`. There is no
 * "ask", so ask becomes deny with instructions. AfterTool `deny` would hide
 * the tool result, so edit feedback goes into additionalContext instead.
 * stdout must contain nothing but the JSON.
 * Reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
 */

function geminiToolAction(tool: string, input: Record<string, unknown>): ToolAction {
  const path = str(input.file_path) ?? str(input.absolute_path) ?? str(input.path);
  switch (tool) {
    case 'run_shell_command':
      return { type: 'shell', command: str(input.command) ?? '', ...(str(input.dir_path) ? { cwd: str(input.dir_path) } : {}), shell: 'bash' };
    case 'read_file':
      return path ? { type: 'read', paths: [path] } : { type: 'other', name: tool };
    case 'read_many_files': {
      const include = Array.isArray(input.include) ? (input.include as unknown[]).filter((p): p is string => typeof p === 'string') : [];
      const paths = Array.isArray(input.paths) ? (input.paths as unknown[]).filter((p): p is string => typeof p === 'string') : [];
      return { type: 'read', paths: [...include, ...paths] };
    }
    case 'write_file':
      return path ? { type: 'write', files: [{ path, content: str(input.content) ?? '' }] } : { type: 'other', name: tool };
    case 'replace':
      return path ? { type: 'write', files: [{ path, added: str(input.new_string) ?? '' }] } : { type: 'other', name: tool };
    default:
      return { type: 'other', name: tool };
  }
}

function toolResponseText(value: unknown): string {
  const o = obj(value);
  if (typeof o.llmContent === 'string') return o.llmContent;
  if (typeof o.returnDisplay === 'string') return o.returnDisplay;
  return typeof value === 'string' ? value : '';
}

export const gemini: Adapter = {
  agent: 'gemini',
  events: ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent'],
  parse(event, payload, cwd) {
    const ctx = { sessionId: str(payload.session_id) ?? '', cwd: str(payload.cwd) || cwd };
    const tool = str(payload.tool_name) ?? '';
    const input = obj(payload.tool_input);
    let parsed: HookEvent;
    switch (event) {
      case 'SessionStart':
        parsed = { kind: 'session-start', source: str(payload.source) };
        break;
      case 'BeforeAgent':
        parsed = { kind: 'prompt', prompt: str(payload.prompt) ?? '' };
        break;
      case 'BeforeTool':
        parsed = { kind: 'pre-tool', tool, action: geminiToolAction(tool, input) };
        break;
      case 'AfterTool':
        parsed = { kind: 'post-tool', tool, action: geminiToolAction(tool, input), output: toolResponseText(payload.tool_response) };
        break;
      case 'AfterAgent':
        parsed = { kind: 'stop', subagent: false, stopHookActive: payload.stop_hook_active === true };
        break;
      default:
        parsed = { kind: 'ignore', why: `event ${event} is not handled` };
    }
    return { ctx, event: parsed };
  },
  format(_event: HookEvent, decision: HookDecision, ctx: HookContext): HookOutput {
    const notice = 'notice' in decision && decision.notice ? { systemMessage: decision.notice } : {};
    switch (decision.type) {
      case 'allow':
        return { stdout: decision.notice ? json(notice) : '', exitCode: 0 };
      case 'context':
        if (ctx.event === 'AfterAgent') return { stdout: json({ systemMessage: decision.notice ?? decision.text }), exitCode: 0 };
        return { stdout: json({ ...notice, hookSpecificOutput: { hookEventName: ctx.event, additionalContext: decision.text } }), exitCode: 0 };
      case 'deny':
      case 'ask':
        return { stdout: json({ decision: 'deny', reason: decision.reason }), exitCode: 0 };
      case 'feedback':
        return { stdout: json({ hookSpecificOutput: { hookEventName: ctx.event, additionalContext: decision.reason } }), exitCode: 0 };
      case 'continue':
        return { stdout: json({ decision: 'deny', reason: decision.reason }), exitCode: 0 };
      case 'block-prompt':
        return { stdout: json({ decision: 'deny', reason: decision.message, systemMessage: decision.message }), exitCode: 0 };
    }
    return { stdout: '', exitCode: 0 };
  },
  failOpen(_event, notice) {
    return { stdout: json({ systemMessage: notice }), exitCode: 0 };
  },
};
