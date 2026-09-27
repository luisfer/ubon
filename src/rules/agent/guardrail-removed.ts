import { parse as parseYaml } from 'yaml';
import { type UbonConfig, defaultConfig } from '../../core/config.ts';
import { isRecord, parseStructured } from '../../lang/structured.ts';
import { RULES } from '../index.ts';
import type { DiffContext, Rule } from '../types.ts';
import { HOOK_KINDS, type ConfigKind, at, configKind, hookSection, parseConfig } from './config-files.ts';

/**
 * A change that removes Ubon or another checker from agent hooks, git hooks,
 * or CI, or lowers Ubon's own levels. In an agent session the agent should not
 * make that change on its own, so it blocks; outside a session it warns, so
 * human-made removals stay visible in the pull request without blocking.
 */

/** Commands that run a checker. */
const CHECKER = /\bubon\b|\b(lint-staged|eslint|biome|oxlint|tsc|vue-tsc|svelte-check|vitest|jest|mocha|ava|playwright test|pytest|ruff|mypy|gitleaks|trufflehog|detect-secrets|semgrep|secretlint|ggshield|talisman|commitlint|stylelint|golangci-lint|zizmor|osv-scanner|trivy|grype|snyk|codeql)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|check)\b|\bcargo\s+(test|clippy)\b|\bgo\s+(test|vet)\b|\bprettier\s+(--check|-c)\b/i;

/** CI steps that only other rules cover in depth; this rule checks Ubon and security scanners there. */
const CI_CHECKER = /\bubon\b|luisfer\/ubon|\b(gitleaks|trufflehog|semgrep|zizmor|osv-scanner|trivy|grype|snyk|codeql|dependency-review|socket|scorecard)\b|\b(npm|pnpm|yarn|bun) audit\b/i;

const GIT_HOOK_FILE = /(^|\/)\.husky\/(?!_\/)[^/]+$|(^|\/)\.githooks\/[^/]+$/;
const LEFTHOOK = /(^|\/)\.?lefthook\.ya?ml$/;
const PRE_COMMIT = /(^|\/)\.pre-commit-config\.ya?ml$/;
const WORKFLOW = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
const SIMPLE_GIT_HOOKS = /(^|\/)\.?simple-git-hooks\.json$/;

interface Removal {
  line: number;
  message: string;
  key: string;
}

function checkerName(text: string, re: RegExp = CHECKER): string {
  const m = re.exec(text);
  return m ? m[0].trim() : 'a checker';
}

/** Every checker a command runs, by name. */
function checkerNames(text: string): Set<string> {
  const global = new RegExp(CHECKER.source, 'gi');
  return new Set([...text.matchAll(global)].map((m) => m[0].trim().toLowerCase().replace(/\s+/g, ' ')));
}

/** Checkers that ran in `before` and no longer run in `after`. */
function lostCheckers(before: string, after: string | undefined): string[] {
  const now = checkerNames(after ?? '');
  return [...checkerNames(before)].filter((n) => !now.has(n));
}

// ---------------------------------------------------------------------------
// Agent hook config

function agentHookRemovals(ctx: DiffContext, kind: ConfigKind): Removal[] {
  const files = ctx.scopeFiles.map((f) => f.path);
  const before = ctx.before ? parseConfig(ctx.file.path, ctx.before, kind) : null;
  const after = ctx.after ? parseConfig(ctx.file.path, ctx.after, kind) : null;
  if (!before?.data) return [];
  const beforeHooks = hookSection(before, files)?.handlers ?? [];
  const afterHooks = after?.data ? (hookSection(after, files)?.handlers ?? []) : [];
  const out: Removal[] = [];
  // Each event is a different check (Stop is the finish gate, PreToolUse the command check), so compare per event.
  // A command that moved verbatim to another event still runs.
  const afterByEvent = new Map<string, Set<string>>();
  for (const h of afterHooks) {
    const names = afterByEvent.get(h.event) ?? new Set<string>();
    for (const c of h.commands) for (const n of checkerNames(c.text)) names.add(n);
    afterByEvent.set(h.event, names);
  }
  const afterAny = new Set(afterHooks.flatMap((h) => h.commands.map((c) => norm(c.text))));
  const matchers = (m: string | null) => new Set((m ?? '*').split(/[|,]/).map((s) => s.trim()).filter(Boolean));
  const reportedEvents = new Set<string>();
  for (const h of beforeHooks) {
    for (const c of h.commands) {
      if (!CHECKER.test(c.text)) continue;
      const lineAfter = after?.lineOf(['hooks', h.event]) ?? after?.lineOf(['hooks']) ?? 1;
      const moved = afterAny.has(norm(c.text));
      const sameEvent = afterByEvent.get(h.event) ?? new Set<string>();
      const lost = moved ? [] : [...checkerNames(c.text)].filter((n) => !sameEvent.has(n));
      if (lost.length > 0) {
        if (!reportedEvents.has(`${h.event}:${lost.join(',')}`)) {
          reportedEvents.add(`${h.event}:${lost.join(',')}`);
          out.push({ line: lineAfter, message: `This change removes ${lost.join(' and ')} from the ${h.event} hook (\`${short(c.text)}\`).`, key: `hook:${h.event}:${lost.join(',')}` });
        }
        continue;
      }
      // Same command, narrower matcher: the check no longer runs for some tools.
      const same = afterHooks.find((a) => a.event === h.event && a.commands.some((ac) => norm(ac.text) === norm(c.text)));
      if (same && h.matcher !== same.matcher) {
        const was = matchers(h.matcher);
        const now = matchers(same.matcher);
        const lost = [...was].filter((t) => !now.has(t) && !now.has('*') && !/[^\w|, -]/.test(h.matcher ?? ''));
        if (lost.length > 0 && !/[^\w|, -]/.test(same.matcher ?? '')) {
          out.push({ line: same.line, message: `This change stops the ${h.event} hook that runs ${checkerName(c.text)} from running for ${lost.join(', ')}.`, key: `matcher:${h.event}:${lost.join(',')}` });
        }
      }
    }
  }
  if (after?.data && at(after.data, ['disableAllHooks']) === true && at(before.data, ['disableAllHooks']) !== true) {
    out.push({ line: after.lineOf(['disableAllHooks']) ?? 1, message: 'This change sets disableAllHooks: true, which turns off every hook, including the checks.', key: 'disableAllHooks' });
  }
  return out;
}

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function short(text: string): string {
  const t = norm(text);
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}

// ---------------------------------------------------------------------------
// Git hooks

/** A shell line without its trailing comment, whitespace collapsed. */
function code(line: string): string {
  return norm(line.replace(/(^|\s)#.*$/, ''));
}

function lineRemovals(ctx: DiffContext, where: string): Removal[] {
  const out: Removal[] = [];
  const afterText = ctx.after ?? '';
  const afterCode = afterText.split('\n').map(code).join('\n');
  for (const r of ctx.removed) {
    const text = code(r.text);
    if (!text || !CHECKER.test(text)) continue;
    const lost = lostCheckers(text, afterCode);
    if (lost.length === 0) continue;
    // The removed line is gone; report at the same position in the new file, or its last line.
    const lastLine = Math.max(1, afterText.replace(/\n$/, '').split('\n').length);
    const line = ctx.after === null ? 1 : Math.min(Math.max(1, r.line), lastLine);
    out.push({ line, message: `This change removes \`${short(text)}\` from ${where}, so ${lost.join(' and ')} no longer runs.`, key: `line:${lost.join(',')}` });
  }
  return out;
}

function yamlData(text: string | null): unknown {
  if (!text) return null;
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

/** lefthook: every `run` of commands, jobs, and scripts, keyed by hook and name. */
function lefthookRuns(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!isRecord(data)) return out;
  for (const [hook, cfg] of Object.entries(data)) {
    if (!isRecord(cfg)) continue;
    if (isRecord(cfg.commands)) for (const [name, c] of Object.entries(cfg.commands)) if (isRecord(c) && typeof c.run === 'string') out.set(`${hook}/${name}`, c.run);
    if (Array.isArray(cfg.jobs)) cfg.jobs.forEach((j, i) => isRecord(j) && typeof j.run === 'string' && out.set(`${hook}/${typeof j.name === 'string' ? j.name : i}`, j.run));
    if (isRecord(cfg.scripts)) for (const [name, s] of Object.entries(cfg.scripts)) if (isRecord(s) && typeof s.runner === 'string') out.set(`${hook}/${name}`, `${s.runner} ${name}`);
  }
  return out;
}

function lefthookSkipped(data: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(data)) return out;
  for (const [hook, cfg] of Object.entries(data)) {
    if (!isRecord(cfg)) continue;
    if (cfg.skip === true) out.add(hook);
    if (isRecord(cfg.commands)) for (const [name, c] of Object.entries(cfg.commands)) if (isRecord(c) && c.skip === true) out.add(`${hook}/${name}`);
  }
  return out;
}

function lefthookRemovals(ctx: DiffContext): Removal[] {
  const before = lefthookRuns(yamlData(ctx.before));
  const afterData = yamlData(ctx.after);
  const after = lefthookRuns(afterData);
  const out: Removal[] = [];
  const lineOf = (needle: string) => {
    const lines = (ctx.after ?? '').split('\n');
    const i = lines.findIndex((l) => l.includes(needle));
    return i >= 0 ? i + 1 : 1;
  };
  // A checker still counts when any hook runs it after the change (a command moved from pre-commit to pre-push).
  const stillRuns = checkerNames([...after.values()].join('\n'));
  for (const [key, run] of before) {
    const lost = [...checkerNames(run)].filter((n) => !stillRuns.has(n));
    if (lost.length === 0) continue;
    out.push({ line: lineOf(key.split('/')[0] as string), message: `This change removes the lefthook ${key} command, so ${lost.join(' and ')} no longer runs.`, key: `lefthook:${key}` });
  }
  const skippedBefore = lefthookSkipped(yamlData(ctx.before));
  for (const key of lefthookSkipped(afterData)) {
    if (skippedBefore.has(key)) continue;
    const runs = [...before.entries()].filter(([k]) => k === key || k.startsWith(`${key}/`));
    if (runs.some(([, r]) => CHECKER.test(r))) out.push({ line: lineOf('skip'), message: `This change adds skip: true to lefthook ${key}, so its checks no longer run.`, key: `lefthook-skip:${key}` });
  }
  return out;
}

function preCommitIds(data: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(data) || !Array.isArray(data.repos)) return out;
  for (const repo of data.repos) {
    if (!isRecord(repo) || !Array.isArray(repo.hooks)) continue;
    for (const h of repo.hooks) if (isRecord(h) && typeof h.id === 'string') out.add(h.id);
  }
  return out;
}

function preCommitRemovals(ctx: DiffContext): Removal[] {
  const before = preCommitIds(yamlData(ctx.before));
  const after = preCommitIds(yamlData(ctx.after));
  const out: Removal[] = [];
  const lines = (ctx.after ?? '').split('\n');
  const reposLine = Math.max(1, lines.findIndex((l) => /^repos:/.test(l)) + 1);
  for (const id of before) {
    if (after.has(id)) continue;
    if (!CHECKER.test(id) && !/secret|lint|check|test|audit|scan|leak|mypy|ruff|bandit|ubon/i.test(id)) continue;
    out.push({ line: reposLine, message: `This change removes the pre-commit hook ${id}.`, key: `pre-commit:${id}` });
  }
  return out;
}

function simpleGitHooks(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const cfg = isRecord(data) ? (isRecord(data['simple-git-hooks']) ? data['simple-git-hooks'] : data) : null;
  if (!isRecord(cfg)) return out;
  for (const [hook, cmd] of Object.entries(cfg)) if (typeof cmd === 'string' && /^(pre|post|commit|prepare|applypatch)/.test(hook)) out.set(hook, cmd);
  return out;
}

function huskyV4(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const hooks = isRecord(data) && isRecord(data.husky) && isRecord(data.husky.hooks) ? data.husky.hooks : null;
  if (hooks) for (const [hook, cmd] of Object.entries(hooks)) if (typeof cmd === 'string') out.set(hook, cmd);
  return out;
}

function jsonData(text: string | null): unknown {
  if (!text) return null;
  const parsed = parseStructured(text, 'json');
  return parsed.errors.length === 0 ? parsed.data : null;
}

function packageJsonRemovals(ctx: DiffContext): Removal[] {
  const beforeData = jsonData(ctx.before);
  const afterData = jsonData(ctx.after);
  const out: Removal[] = [];
  for (const [label, read] of [
    ['simple-git-hooks', (d: unknown) => (isRecord(d) && isRecord(d['simple-git-hooks']) ? simpleGitHooks(d) : new Map<string, string>())],
    ['husky', huskyV4],
  ] as const) {
    const before = read(beforeData);
    const after = read(afterData);
    for (const [hook, cmd] of before) {
      const lost = lostCheckers(cmd, after.get(hook));
      if (lost.length === 0) continue;
      const lines = (ctx.after ?? '').split('\n');
      const i = lines.findIndex((l) => l.includes(`"${label}"`));
      out.push({ line: i >= 0 ? i + 1 : 1, message: `This change removes ${lost.join(' and ')} from the ${hook} hook in the ${label} config.`, key: `${label}:${hook}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CI workflows

interface Step {
  key: string;
  text: string;
  disabled: boolean;
  failOn: string | null;
}

function workflowSteps(data: unknown): Step[] {
  const out: Step[] = [];
  if (!isRecord(data) || !isRecord(data.jobs)) return out;
  for (const [jobId, job] of Object.entries(data.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    const jobDisabled = job.if === false || job.if === 'false' || job['continue-on-error'] === true;
    job.steps.forEach((step, i) => {
      if (!isRecord(step)) return;
      const uses = typeof step.uses === 'string' ? step.uses : '';
      const run = typeof step.run === 'string' ? step.run : '';
      const name = typeof step.name === 'string' ? step.name : '';
      const withs = isRecord(step.with) ? step.with : {};
      const text = `${uses} ${run}`.trim();
      const id = typeof step.id === 'string' ? step.id : name || uses || `${i}`;
      out.push({
        key: `${jobId}/${id}`,
        text,
        disabled: jobDisabled || step.if === false || step.if === 'false' || step['continue-on-error'] === true,
        failOn: typeof withs['fail-on'] === 'string' ? (withs['fail-on'] as string) : null,
      });
    });
  }
  return out;
}

/**
 * The part of a step that says which checker it runs. The CodeQL actions
 * other than analyze prepare the analysis or upload another tool's results
 * (upload-sarif), so they do not count as running CodeQL.
 */
function checkerText(text: string): string {
  return text.replace(/github\/codeql-action\/(init|autobuild|upload-sarif|resolve-environment)@\S*/gi, '');
}

/** Every CI checker the steps run, by name. */
function ciCheckerNames(steps: readonly Step[]): Set<string> {
  const global = new RegExp(CI_CHECKER.source, 'gi');
  return new Set(steps.flatMap((s) => [...checkerText(s.text).matchAll(global)].map((m) => m[0].trim().toLowerCase())));
}

function workflowRemovals(ctx: DiffContext): Removal[] {
  const before = workflowSteps(yamlData(ctx.before)).filter((s) => CI_CHECKER.test(checkerText(s.text)) && !s.disabled);
  const after = workflowSteps(yamlData(ctx.after));
  // A checker still counts when another step runs it after the change (steps merged or moved to another job).
  const stillRuns = ciCheckerNames(after.filter((a) => !a.disabled));
  const out: Removal[] = [];
  const lineOf = (needle: string) => {
    const lines = (ctx.after ?? '').split('\n');
    const i = lines.findIndex((l) => l.includes(needle));
    return i >= 0 ? i + 1 : 1;
  };
  const jobLine = (jobId: string) => {
    const lines = (ctx.after ?? '').split('\n');
    const i = lines.findIndex((l) => new RegExp(`^\\s+${jobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(#.*)?$`).test(l));
    return i >= 0 ? i + 1 : 1;
  };
  for (const s of before) {
    const match = after.find((a) => norm(a.text) === norm(s.text)) ?? after.find((a) => a.key === s.key && CI_CHECKER.test(checkerText(a.text)));
    const name = checkerName(checkerText(s.text), CI_CHECKER);
    if (!match) {
      if (stillRuns.has(name.toLowerCase())) continue;
      out.push({ line: jobLine(s.key.split('/')[0] as string), message: `This change removes the CI step that runs ${name}.`, key: `ci:${s.key}` });
      continue;
    }
    if (match.disabled) out.push({ line: lineOf(match.text.split(' ')[0] ?? name), message: `This change turns off the CI step that runs ${name} (if: false or continue-on-error: true).`, key: `ci-off:${s.key}` });
    else if (/ubon/i.test(s.text) && match.failOn === 'never' && s.failOn !== 'never') out.push({ line: lineOf('fail-on'), message: 'This change sets fail-on: never on the Ubon step, so blocking findings no longer fail CI.', key: `ci-failon:${s.key}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ubon.json

const RANK = { off: 0, warn: 1, block: 2 } as const;

function readUbonConfig(text: string | null): Partial<UbonConfig> & { rules?: Record<string, string> } {
  const raw = jsonData(text);
  return isRecord(raw) ? (raw as Partial<UbonConfig>) : {};
}

function effectiveLevel(rules: Record<string, string> | undefined, id: string, fallback: 'block' | 'warn'): 'off' | 'warn' | 'block' {
  const exact = rules?.[id];
  const pack = rules?.[`${id.split('/')[0]}/*`];
  const v = exact ?? pack ?? fallback;
  return v === 'off' || v === 'warn' || v === 'block' ? v : fallback;
}

function ubonConfigRemovals(ctx: DiffContext): Removal[] {
  const before = readUbonConfig(ctx.before);
  const after = readUbonConfig(ctx.after);
  const defaults = defaultConfig();
  const out: Removal[] = [];
  const lines = (ctx.after ?? '').split('\n');
  const lineOf = (needle: string) => {
    const i = lines.findIndex((l) => l.includes(needle));
    return i >= 0 ? i + 1 : 1;
  };
  const lowered: string[] = [];
  for (const rule of RULES) {
    const id = rule.meta.id;
    const was = effectiveLevel(before.rules, id, rule.meta.level);
    const now = effectiveLevel(after.rules, id, rule.meta.level);
    if (RANK[now] < RANK[was]) lowered.push(`${id} (${was} to ${now})`);
  }
  if (lowered.length > 0) {
    const first = lowered[0]?.split(' ')[0] ?? '';
    const packKey = `${first.split('/')[0]}/*`;
    const line = lineOf(`"${first}"`) !== 1 ? lineOf(`"${first}"`) : lineOf(`"${packKey}"`);
    out.push({ line, message: `This change lowers ${lowered.length === 1 ? 'the level of' : `${lowered.length} rule levels, including`} ${lowered[0]} in ubon.json.`, key: 'levels' });
  }
  const added = (a: readonly string[] | undefined, b: readonly string[] | undefined) => (b ?? []).filter((x) => !(a ?? []).includes(x));
  const addedIgnore = added(before.ignore, after.ignore);
  if (addedIgnore.length > 0) out.push({ line: lineOf(`"${addedIgnore[0]}"`), message: `This change adds ${addedIgnore.join(', ')} to ignore in ubon.json, so those files are no longer checked.`, key: 'ignore' });
  const addedAllow = added(before.commands?.allow, after.commands?.allow);
  if (addedAllow.length > 0) out.push({ line: lineOf(`"${addedAllow[0]}"`), message: `This change adds ${addedAllow.map((a) => `"${a}"`).join(', ')} to commands.allow in ubon.json.`, key: 'commands.allow' });
  for (const kind of ['deny', 'ask'] as const) {
    const removed = added(after.commands?.[kind], before.commands?.[kind]);
    if (removed.length > 0) out.push({ line: lineOf('"commands"'), message: `This change removes ${removed.map((a) => `"${a}"`).join(', ')} from commands.${kind} in ubon.json.`, key: `commands.${kind}` });
  }
  const addedPackages = added(before.packages?.allow, after.packages?.allow);
  if (addedPackages.length > 0) out.push({ line: lineOf(`"${addedPackages[0]}"`), message: `This change adds ${addedPackages.join(', ')} to packages.allow in ubon.json, which skips the package checks for them.`, key: 'packages.allow' });
  for (const field of ['minAgeDays', 'minReleaseAgeHours'] as const) {
    const was = before.packages?.[field] ?? defaults.packages[field];
    const now = after.packages?.[field] ?? defaults.packages[field];
    if (typeof was === 'number' && typeof now === 'number' && now < was) out.push({ line: lineOf(`"${field}"`), message: `This change lowers packages.${field} from ${was} to ${now} in ubon.json.`, key: field });
  }
  const pairs: Array<[string, unknown, unknown, unknown]> = [
    ['session.stop', before.session?.stop ?? defaults.session.stop, after.session?.stop ?? defaults.session.stop, 'block'],
    ['prompts.secrets', before.prompts?.secrets ?? defaults.prompts.secrets, after.prompts?.secrets ?? defaults.prompts.secrets, 'block'],
    ['suppressions.agent', before.suppressions?.agent ?? defaults.suppressions.agent, after.suppressions?.agent ?? defaults.suppressions.agent, 'human-only'],
  ];
  for (const [name, was, now, strict] of pairs) {
    if (was === strict && now !== strict) out.push({ line: lineOf(`"${name.split('.')[1]}"`), message: `This change sets ${name} to "${String(now)}" in ubon.json (it was "${String(was)}").`, key: name });
  }
  return out;
}

export const guardrailRemoved: Rule = {
  meta: {
    id: 'agent/guardrail-removed',
    level: 'block',
    scope: 'diff',
    title: 'Checks removed or turned down',
    summary: 'A change that removes Ubon or another checker from agent hooks, git hooks (husky, lefthook, pre-commit, simple-git-hooks), or CI workflows, or that lowers levels, adds ignores, or relaxes command and package policies in ubon.json.',
    why: 'An agent that is blocked by a check can make the block go away by removing the check. A person can decide to do that; the agent should not do it silently, so in an agent session the change needs a person.',
    fix: 'Restore the check and fix what it reports; if the check itself is wrong, ask the user to change it.',
    cwe: ['CWE-693'],
    owasp: ['ASI02', 'ASI10'],
    levels: 'block during an agent session; warn outside one (in CI and for human commits), so human-made changes are visible without failing the build.',
  },
  appliesTo: (file) => !file.generated,
  diff(ctx) {
    const path = ctx.file.path;
    const kind = configKind(path);
    let removals: Removal[] = [];
    if (path === 'ubon.json') removals = ubonConfigRemovals(ctx);
    else if (kind && HOOK_KINDS.has(kind)) removals = agentHookRemovals(ctx, kind);
    else if (GIT_HOOK_FILE.test(path)) removals = lineRemovals(ctx, path);
    else if (LEFTHOOK.test(path)) removals = lefthookRemovals(ctx);
    else if (PRE_COMMIT.test(path)) removals = preCommitRemovals(ctx);
    else if (WORKFLOW.test(path)) removals = workflowRemovals(ctx);
    else if (kind === 'package-json') removals = packageJsonRemovals(ctx);
    else if (SIMPLE_GIT_HOOKS.test(path)) {
      const before = simpleGitHooks(jsonData(ctx.before));
      const after = simpleGitHooks(jsonData(ctx.after));
      for (const [hook, cmd] of before) {
        const lost = lostCheckers(cmd, after.get(hook));
        if (lost.length > 0) removals.push({ line: 1, message: `This change removes ${lost.join(' and ')} from the ${hook} hook.`, key: `sgh:${hook}` });
      }
    }
    const level = ctx.session ? 'block' : 'warn';
    const seen = new Set<string>();
    for (const r of removals) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      ctx.report({ line: r.line, level, message: r.message, key: r.key, evidence: r.key.slice(0, 120) });
    }
  },
};
