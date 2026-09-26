import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { ConfigError, type UbonConfig, defaultConfig, loadConfig } from '../core/config.ts';
import { git, repoRoot } from '../core/git.ts';
import { maskValue, safeText } from '../core/mask.ts';
import { type SessionEvent, appendEvent, findingsHash, loadSession, readEvents, sanitizeSessionId, startSession } from '../core/session.ts';
import type { Finding } from '../core/types.ts';
import { toPosix } from '../core/files.ts';
import { AGENT_INSTRUCTIONS, formatFindingLine } from '../report/agent.ts';
import type { ActionVerdict, CommandContext } from '../rules/agent/command-types.ts';
import type { PackageVetter } from '../rules/deps/verdict.ts';
import { ruleIds } from '../rules/index.ts';
import { isEnvFileName } from '../rules/secret/names.ts';
import { findProviderKeys } from '../rules/secret/provider-key.ts';
import { adapterFor } from './adapters/index.ts';
import type { AgentId, HookContext, HookDecision, HookEvent, HookOutput, ToolAction } from './types.ts';

/**
 * The hook runtime: one event in, one decision out. Every agent goes through
 * the same code; adapters only translate formats. Nothing here throws past
 * runHookEvent: on any internal error the action is allowed and the user sees
 * a notice, because a broken checker must not break the session, and must
 * not look like a clean pass either.
 */

export interface HookChecks {
  /** Command checks (agent/destructive-command and the others). */
  checkCommand(command: string, ctx: CommandContext): Promise<ActionVerdict[]>;
  /** secret/read-sensitive-file for read tools. */
  checkReadPath(path: string, ctx: CommandContext): ActionVerdict | null;
  /** agent/protected-path-write. */
  checkWritePath(path: string, ctx: CommandContext): ActionVerdict | null;
  /** Hidden or direction-changing characters, for content about to be written to agent files. */
  hasHiddenUnicode(text: string, path: string): string | null;
  vetPackages?: PackageVetter;
}

export interface RunHookInput {
  agent: AgentId;
  event: string;
  payload: Record<string, unknown>;
  /** Process working directory, used when the payload has no cwd. */
  cwd: string;
  checks: HookChecks;
  now?: Date;
}

export interface RunHookResult {
  output: HookOutput;
  decision: HookDecision;
  event: HookEvent;
}

const STOP_GUARD = 2;

export async function runHookEvent(input: RunHookInput): Promise<RunHookResult> {
  const adapter = adapterFor(input.agent);
  if (!adapter) throw new Error(`unknown agent ${input.agent}`);
  const started = performance.now();
  const parsed = adapter.parse(input.event, input.payload, input.cwd);
  const cwd = parsed.ctx.cwd && existsSync(parsed.ctx.cwd) ? parsed.ctx.cwd : input.cwd;
  const ctx: HookContext = { ...parsed.ctx, cwd, agent: input.agent, event: input.event, sessionId: sanitizeSessionId(parsed.ctx.sessionId || 'default') };
  const event = parsed.event;
  const root = repoRoot(cwd) ?? cwd;

  let config: UbonConfig;
  let configNotice: string | undefined;
  try {
    config = loadConfig(root, ruleIds()).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // An invalid ubon.json must not switch Ubon off: fall back to the defaults.
    config = defaultConfig();
    configNotice = `ubon: ${error.message} Using the default settings until it is fixed.`;
  }

  const key = ctx.toolUseId ? `${input.event}:${ctx.toolUseId}` : undefined;
  if (key && (event.kind === 'pre-tool' || event.kind === 'post-tool')) {
    const previous = readEvents(root, ctx.sessionId, 500).find((e) => e.key === key);
    if (previous && previous.reason !== undefined) {
      const replay = replayDecision(previous);
      if (replay) return { output: adapter.format(event, replay, ctx), decision: replay, event };
    }
  }

  const runtime = new HookRuntime(root, ctx, config, input.checks, input.now ?? new Date());
  let decision = await runtime.handle(event);
  if (configNotice) decision = withNotice(decision, configNotice);

  const logged: SessionEvent = {
    at: (input.now ?? new Date()).toISOString(),
    agent: input.agent,
    event: input.event,
    decision: decision.type,
    ms: Math.round(performance.now() - started),
    ...(event.kind === 'pre-tool' || event.kind === 'post-tool' ? { tool: event.tool } : {}),
    ...(key ? { key } : {}),
    ...runtime.logExtra,
    ...(decision.type !== 'allow' ? { reason: reasonOf(decision) } : {}),
  };
  if (event.kind !== 'ignore') appendEvent(root, ctx.sessionId, logged);
  return { output: adapter.format(event, decision, ctx), decision, event };
}

function reasonOf(d: HookDecision): string {
  switch (d.type) {
    case 'context':
      return d.text;
    case 'block-prompt':
      return d.message;
    case 'allow':
      return '';
    default:
      return d.reason;
  }
}

function replayDecision(e: SessionEvent): HookDecision | null {
  const reason = e.reason ?? '';
  switch (e.decision) {
    case 'allow':
      return { type: 'allow' };
    case 'deny':
    case 'ask':
    case 'feedback':
    case 'continue':
      return { type: e.decision, reason };
    case 'context':
      return { type: 'context', text: reason };
    default:
      return null;
  }
}

function withNotice(d: HookDecision, notice: string): HookDecision {
  if (d.type === 'allow' || d.type === 'context') return { ...d, notice: d.notice ? `${d.notice}\n${notice}` : notice };
  return d;
}

class HookRuntime {
  readonly logExtra: Partial<SessionEvent> = {};
  private readonly root: string;
  private readonly ctx: HookContext;
  private readonly config: UbonConfig;
  private readonly checks: HookChecks;
  private readonly now: Date;

  constructor(root: string, ctx: HookContext, config: UbonConfig, checks: HookChecks, now: Date) {
    this.root = root;
    this.ctx = ctx;
    this.config = config;
    this.checks = checks;
    this.now = now;
  }

  async handle(event: HookEvent): Promise<HookDecision> {
    switch (event.kind) {
      case 'session-start':
        return this.sessionStart(event.source);
      case 'prompt':
        return this.prompt(event.prompt);
      case 'pre-tool':
        return this.preTool(event.action);
      case 'post-tool':
        return this.postTool(event.action, event.output);
      case 'stop':
        return this.stop(event.subagent, event.status);
      default:
        return { type: 'allow' };
    }
  }

  private sessionStart(source: string | undefined): HookDecision {
    const existing = loadSession(this.root, this.ctx.sessionId);
    if (!existing) startSession(this.root, this.ctx.sessionId, this.ctx.agent, this.config.maxFileSize, this.now);
    void source;
    return {
      type: 'context',
      text: 'Ubon is active in this session. It checks shell commands before they run, files after you edit them, and every change before you finish. Fix BLOCK findings it reports; if one is wrong, suppress it with a truthful reason (`ubon explain <rule>` shows how) and tell the user.',
    };
  }

  private prompt(prompt: string): HookDecision {
    const keys = findProviderKeys(prompt);
    if (keys.length === 0) return { type: 'allow' };
    this.logExtra.rules = ['secret/in-prompt'];
    const names = [...new Set(keys.map((k) => `${k.format.name} (${maskValue(k.value, k.format.prefix)})`))].join(', ');
    if (this.config.prompts.secrets === 'warn') {
      return {
        type: 'context',
        text: `The user's prompt contains ${names}. Do not repeat the value anywhere, and suggest moving it to an ignored .env file.`,
        notice: `ubon: your prompt contains ${names}. It was sent to the model provider; consider rotating it.`,
      };
    }
    return {
      type: 'block-prompt',
      message: `Ubon blocked this prompt because it contains ${names}. Put the key in an ignored .env file and refer to it by its variable name. The prompt was not sent.`,
    };
  }

  private commandContext(): CommandContext {
    const root = this.root;
    const cwd = this.ctx.cwd;
    const config = this.config;
    const checks = this.checks;
    return {
      cwd,
      root,
      config,
      hasUncommittedChanges() {
        const out = git(root, ['status', '--porcelain', '--untracked-files=no']);
        return out === null ? true : out.trim().length > 0;
      },
      currentBranch() {
        const out = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
        return out ? out.trim() : null;
      },
      ...(checks.vetPackages
        ? {
            vetPackages: (specs: readonly string[]) =>
              (checks.vetPackages as PackageVetter)(specs, {
                root,
                online: config.packages.online,
                minAgeDays: config.packages.minAgeDays,
                minReleaseAgeHours: config.packages.minReleaseAgeHours,
                allow: config.packages.allow,
                timeoutMs: 4000,
              }),
          }
        : {}),
    };
  }

  private async preTool(action: ToolAction): Promise<HookDecision> {
    const cmdCtx = this.commandContext();
    const verdicts: ActionVerdict[] = [];
    if (action.type === 'shell') {
      if (action.command.trim()) verdicts.push(...(await this.checks.checkCommand(action.command, cmdCtx)));
    } else if (action.type === 'read') {
      for (const path of action.paths) {
        const v = this.checks.checkReadPath(path, cmdCtx);
        if (v) verdicts.push(v);
      }
    } else if (action.type === 'write') {
      for (const file of action.files) {
        const rel = this.relative(file.path);
        const v = this.checks.checkWritePath(file.path, cmdCtx);
        if (v) verdicts.push(v);
        if (file.deleted) continue;
        const text = file.content ?? file.added ?? '';
        if (!text) continue;
        const keyVerdict = this.keyInContent(text, rel ?? file.path);
        if (keyVerdict) verdicts.push(keyVerdict);
        const hidden = this.checks.hasHiddenUnicode(text, rel ?? file.path);
        if (hidden) verdicts.push({ rule: 'agent/hidden-unicode', decision: 'deny', reason: hidden, fix: 'Remove the invisible characters from the text you are writing.' });
      }
    }
    if (verdicts.length === 0) return { type: 'allow' };
    this.logExtra.rules = [...new Set(verdicts.map((v) => v.rule))];
    const denies = verdicts.filter((v) => v.decision === 'deny');
    const chosen = denies.length > 0 ? denies : verdicts;
    const lines = chosen.map((v) => `${v.rule}: ${v.reason} ${v.fix}`.trim());
    if (denies.length > 0) return { type: 'deny', reason: `Ubon denied this action.\n${lines.join('\n')}` };
    return {
      type: 'ask',
      reason: `Ubon asks a person to approve this action.\n${lines.join('\n')}\nIf it is intended, the user can approve it, run it themselves, or add it to commands.allow in ubon.json.`,
    };
  }

  /** A provider key about to be written to a file git would commit. */
  private keyInContent(text: string, path: string): ActionVerdict | null {
    const keys = findProviderKeys(text);
    if (keys.length === 0) return null;
    if (isEnvFileName(path) || this.isIgnored(path)) return null;
    const k = keys[0] as (typeof keys)[number];
    return {
      rule: 'secret/provider-key',
      decision: 'deny',
      reason: `The content for ${path} contains ${k.format.name} (${maskValue(k.value, k.format.prefix)}).`,
      fix: 'Read it from an environment variable instead and keep the value in an ignored .env file.',
    };
  }

  private isIgnored(path: string): boolean {
    const out = git(this.root, ['check-ignore', '-q', '--', path]);
    return out !== null;
  }

  private relative(path: string): string | null {
    const abs = isAbsolute(path) ? path : resolve(this.ctx.cwd, path);
    const rel = toPosix(relative(this.root, abs));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    return rel;
  }

  private async postTool(action: ToolAction, output: string): Promise<HookDecision> {
    if (action.type === 'write') {
      const paths = [...new Set(action.files.filter((f) => !f.deleted).map((f) => this.relative(f.path)).filter((p): p is string => p !== null))];
      const existing = paths.filter((p) => existsSync(resolve(this.root, p)));
      this.logExtra.files = existing;
      if (existing.length === 0) return { type: 'allow' };
      const session = loadSession(this.root, this.ctx.sessionId);
      const { runCheck } = await import('../core/engine.ts');
      const { report } = await runCheck({ cwd: this.root, mode: 'session', session, paths: existing, inSession: true, config: this.config });
      const blocking = report.findings.filter((f) => f.level === 'block');
      const warnings = report.findings.filter((f) => f.level === 'warn' && f.introduced !== false);
      if (blocking.length > 0) {
        this.logExtra.rules = [...new Set(blocking.map((f) => f.rule))];
        return { type: 'feedback', reason: findingsMessage('Ubon found problems in the file you just changed. Fix them now, while you have the context:', blocking, warnings) };
      }
      if (warnings.length > 0) {
        this.logExtra.rules = [...new Set(warnings.map((f) => f.rule))];
        return { type: 'context', text: findingsMessage('Ubon warnings for the file you just changed:', [], warnings.slice(0, 5)) };
      }
      return { type: 'allow' };
    }
    if (action.type === 'shell' && action.command) this.logExtra.note = safeText(action.command, 200);
    const keys = output ? findProviderKeys(output) : [];
    if (keys.length === 0) return { type: 'allow' };
    this.logExtra.rules = ['secret/in-tool-output'];
    const names = [...new Set(keys.map((k) => `${k.format.name} (${maskValue(k.value, k.format.prefix)})`))].join(', ');
    return {
      type: 'context',
      text: `The output of that tool contains ${names}. Do not repeat the value. Tell the user which key appeared so they can decide whether to rotate it.`,
    };
  }

  private async stop(subagent: boolean, status: string | undefined): Promise<HookDecision> {
    if (status && status !== 'completed') return { type: 'allow' };
    const session = loadSession(this.root, this.ctx.sessionId);
    const { runCheck } = await import('../core/engine.ts');
    const { report } = await runCheck({ cwd: this.root, mode: 'session', session, inSession: true, config: this.config });
    const blocking = report.findings.filter((f) => f.level === 'block');
    if (blocking.length === 0) return { type: 'allow' };
    const hash = findingsHash(blocking.map((f) => f.fingerprint));
    this.logExtra.findings = hash;
    this.logExtra.rules = [...new Set(blocking.map((f) => f.rule))];
    if (this.config.session.stop === 'warn') {
      return { type: 'allow', notice: `ubon: ${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'} in this session's changes. Run \`ubon check\` to see them.` };
    }
    // Loop guard: after two blocks for the same findings, let the agent stop and record them as unresolved.
    const stops = readEvents(this.root, this.ctx.sessionId)
      .filter((e) => e.event === this.ctx.event && e.decision !== 'error')
      .slice(-STOP_GUARD);
    if (stops.length === STOP_GUARD && stops.every((e) => e.decision === 'continue' && e.findings === hash)) {
      this.logExtra.unresolved = blocking.map((f) => ({ rule: f.rule, file: f.file, line: f.range.start.line, fingerprint: f.fingerprint }));
      return {
        type: 'allow',
        notice: `ubon: the agent stopped with ${blocking.length} unresolved blocking finding${blocking.length === 1 ? '' : 's'} after ${STOP_GUARD} attempts. Run \`ubon check\` to see them; CI will report them too.`,
      };
    }
    void subagent;
    return { type: 'continue', reason: findingsMessage(`Ubon found ${blocking.length} blocking problem${blocking.length === 1 ? '' : 's'} in this session's changes. Fix ${blocking.length === 1 ? 'it' : 'them'} before you finish:`, blocking, [], report.notChecked) };
  }
}

function findingsMessage(header: string, blocking: Finding[], warnings: Finding[], notChecked: string[] = []): string {
  const lines = [header];
  for (const f of blocking.slice(0, 30)) lines.push(formatFindingLine(f));
  if (blocking.length > 30) lines.push(`... and ${blocking.length - 30} more; run \`ubon check\` for all of them.`);
  for (const f of warnings.slice(0, 5)) lines.push(formatFindingLine(f));
  if (notChecked.length > 0) lines.push(`Not checked: ${notChecked.join('; ')}.`);
  if (blocking.length > 0) lines.push(AGENT_INSTRUCTIONS);
  return lines.join('\n');
}
