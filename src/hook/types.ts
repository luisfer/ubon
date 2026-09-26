/**
 * Hook events and decisions, independent of any agent. Adapters translate an
 * agent's payload into a HookEvent and a HookDecision into the exact output
 * that agent reads.
 */

export type AgentId = 'claude' | 'codex' | 'cursor' | 'gemini' | 'copilot';

export const AGENTS: readonly AgentId[] = ['claude', 'codex', 'cursor', 'gemini', 'copilot'];

/** What a tool call does, as far as Ubon is concerned. */
export type ToolAction =
  | { type: 'shell'; command: string; cwd?: string; shell: 'bash' | 'powershell' }
  | { type: 'read'; paths: string[] }
  | {
      type: 'write';
      /** Files the tool writes. `content` is the full new content when the tool provides it; `added` is inserted text (an edit's new string). */
      files: Array<{ path: string; content?: string; added?: string; deleted?: boolean }>;
    }
  | { type: 'other'; name: string };

export type HookEvent =
  | { kind: 'session-start'; source?: string }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'pre-tool'; tool: string; action: ToolAction }
  | { kind: 'post-tool'; tool: string; action: ToolAction; output: string; failed?: boolean }
  | { kind: 'stop'; subagent: boolean; stopHookActive: boolean; status?: string }
  | { kind: 'ignore'; why: string };

export interface HookContext {
  agent: AgentId;
  /** Event name as the agent sent it (and as configured on the command line). */
  event: string;
  sessionId: string;
  /** Working directory of the session, absolute. */
  cwd: string;
  /** Tool call identifier, for idempotency. */
  toolUseId?: string;
}

export type HookDecision =
  /** Nothing to say. */
  | { type: 'allow'; notice?: string }
  /** Information for the model that does not stop anything. */
  | { type: 'context'; text: string; notice?: string }
  /** Before a tool call: refuse it. */
  | { type: 'deny'; reason: string }
  /** Before a tool call: a person should decide. Adapters without "ask" map it to deny with instructions. */
  | { type: 'ask'; reason: string }
  /** After a tool call: tell the model something it must act on. */
  | { type: 'feedback'; reason: string }
  /** At stop: make the agent continue with this instruction. */
  | { type: 'continue'; reason: string }
  /** A prompt must not be sent. The message is for the user. */
  | { type: 'block-prompt'; message: string };

export interface HookOutput {
  stdout: string;
  exitCode: number;
  stderr?: string;
}

export interface Adapter {
  agent: AgentId;
  /** Event names this agent can send, as they appear in its hook config. */
  events: readonly string[];
  parse(event: string, payload: Record<string, unknown>, cwd: string): { ctx: Omit<HookContext, 'agent' | 'event'>; event: HookEvent };
  format(event: HookEvent, decision: HookDecision, ctx: HookContext): HookOutput;
  /** The output that lets the action proceed, used when Ubon fails. */
  failOpen(event: string, notice: string): HookOutput;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function obj(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // not JSON
    }
  }
  return {};
}

/** Tool output as text, whatever shape the agent sends. */
export function outputText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  const o = obj(value);
  const parts = [o.stdout, o.stderr, o.output, o.textResultForLlm, o.text_result_for_llm, o.llmContent, o.content, o.result];
  const text = parts.filter((p) => typeof p === 'string').join('\n');
  if (text) return text;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
