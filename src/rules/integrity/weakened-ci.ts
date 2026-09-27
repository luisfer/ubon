import { type PathKey, isRecord, parseStructured } from '../../lang/structured.ts';
import { snippet } from './shared.ts';
import { CHECK_COMMAND, type Weakening, swallowsFailure } from './weakened-config.ts';

/**
 * GitHub Actions workflows: checks (tests, linters, type checks) that ran at
 * the base and no longer run, or no longer fail the build: the step or job
 * was removed, disabled with `if: false`, given `continue-on-error: true`, or
 * its command now ends in `|| true`. A check that still runs in another job
 * or another workflow file is not reported.
 */

interface CheckUse {
  /** Normalized identity of the check: "run:test", "vitest", "go test", "uses:golangci/golangci-lint-action". */
  sig: string;
  shown: string;
  job: string;
  jobLine: number;
  active: boolean;
  why?: string;
  whyLine?: number;
}

const CHECK_ACTION = /^(golangci\/golangci-lint-action|cypress-io\/github-action|super-linter\/super-linter|github\/super-linter|pre-commit\/action|astral-sh\/ruff-action|chartboost\/ruff-action|reviewdog\/action-[\w-]+|actions-rs\/clippy-check|wearerequired\/lint-action)@/i;

function isFalse(value: unknown): boolean {
  if (value === false || value === 0) return true;
  return typeof value === 'string' && /^\s*(\$\{\{\s*)?(false|0)(\s*\}\})?\s*$/i.test(value);
}

function isTrue(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'string' && /^\s*(\$\{\{\s*)?true(\s*\}\})?\s*$/i.test(value);
}

/** Normalized identity of a check command, so edits to its arguments do not count as a removal. */
export function checkSignature(command: string): string | null {
  // Fixers (lint:fix, eslint --fix, biome check --write) rewrite code; they are not the gate.
  if (/\s--(?:fix|write|apply)\b/.test(command)) return null;
  const m = CHECK_COMMAND.exec(command);
  if (!m) return null;
  const text = m[0].replace(/\s+/g, ' ').trim();
  // `pnpm run --filter=www check` is the check script "check" (scoped to a workspace package).
  let pm = /^(?:npm|pnpm|yarn|bun) ((?:(?:run|--silent|-s|--if-present|-r|--recursive|--filter[= ]\S+|-F \S+|--workspace[= ]\S+|-w \S+|workspace \S+) )*)(\S+)/.exec(text);
  if (pm) {
    const scope = /(?:--filter[= ]|-F |--workspace[= ]|-w |workspace )(\S+)/.exec(pm[1] ?? '')?.[1];
    const script = pm[2] === 't' ? 'test' : (pm[2] as string);
    if (/(?:^|[:_-])(?:fix|write|format)$/.test(script)) return null; // lint:fix, check:write
    return scope ? `run:${scope}:${script}` : `run:${script}`;
  }
  pm = /^npx (\S+)(?: (test|run))?/.exec(text);
  if (pm) return pm[1] === 'playwright' || pm[1] === 'cypress' ? `${pm[1]} ${pm[2] ?? ''}`.trim() : (pm[1] as string);
  pm = /^(turbo)(?: run)? (\S+)/.exec(text);
  if (pm) return `run:${pm[2]}`;
  pm = /^(mvn|gradlew?|nx)\b.*\b(test|verify|check|lint|typecheck)$/.exec(text);
  if (pm) return `${pm[1]} ${pm[2]}`;
  return text;
}

function checksInRun(run: string): Array<{ sig: string; shown: string; swallowed: string | null }> {
  const out: Array<{ sig: string; shown: string; swallowed: string | null }> = [];
  for (const line of run.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    for (const segment of line.split(/&&|;/)) {
      const sig = checkSignature(segment);
      if (!sig) continue;
      out.push({ sig, shown: snippet(segment.replace(/\|\|.*$/, ''), 50), swallowed: swallowsFailure(segment, 'bash-e') });
    }
  }
  return out;
}

export function workflowChecks(text: string): CheckUse[] | null {
  const doc = parseStructured(text, 'yaml');
  if (!isRecord(doc.data)) return null;
  const jobs = doc.data.jobs;
  if (!isRecord(jobs)) return [];
  const out: CheckUse[] = [];
  const line = (path: PathKey[]) => doc.lineOf(path) ?? 1;
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!isRecord(job)) continue;
    const jobLine = line(['jobs', jobId]);
    let jobWhy: { why: string; line: number } | null = null;
    if ('if' in job && isFalse(job.if)) jobWhy = { why: 'its job is turned off with `if: false`', line: line(['jobs', jobId, 'if']) };
    else if (isTrue(job['continue-on-error'])) jobWhy = { why: 'its job has `continue-on-error: true`', line: line(['jobs', jobId, 'continue-on-error']) };
    const steps = Array.isArray(job.steps) ? job.steps : [];
    steps.forEach((step, i) => {
      if (!isRecord(step)) return;
      const uses: Array<{ sig: string; shown: string; swallowed: string | null }> = [];
      if (typeof step.run === 'string') uses.push(...checksInRun(step.run));
      if (typeof step.uses === 'string' && CHECK_ACTION.test(step.uses)) uses.push({ sig: `uses:${step.uses.replace(/@.*$/, '').toLowerCase()}`, shown: step.uses.replace(/@.*$/, ''), swallowed: null });
      if (uses.length === 0) return;
      let stepWhy: { why: string; line: number } | null = jobWhy;
      if (!stepWhy && 'if' in step && isFalse(step.if)) stepWhy = { why: 'its step is turned off with `if: false`', line: line(['jobs', jobId, 'steps', i, 'if']) };
      else if (!stepWhy && isTrue(step['continue-on-error'])) stepWhy = { why: 'its step has `continue-on-error: true`', line: line(['jobs', jobId, 'steps', i, 'continue-on-error']) };
      for (const u of uses) {
        const why = stepWhy ?? (u.swallowed ? { why: `the command ends in \`${u.swallowed}\``, line: doc.valueLineOf(['jobs', jobId, 'steps', i, 'run']) ?? line(['jobs', jobId, 'steps', i]) } : null);
        out.push({ sig: u.sig, shown: u.shown, job: jobId, jobLine, active: why === null, ...(why ? { why: why.why, whyLine: why.line } : {}) });
      }
    });
  }
  return out;
}

/**
 * Checks that were active in this workflow at the base and are active
 * nowhere now (this file after the change, and every other workflow file).
 */
export function workflowWeakenings(path: string, before: string, after: string | null, otherWorkflows: readonly string[]): Weakening[] {
  const base = workflowChecks(before);
  if (!base) return [];
  const current = after === null ? [] : workflowChecks(after);
  if (current === null) return [];
  const activeNow = new Set(current.filter((u) => u.active).map((u) => u.sig));
  for (const text of otherWorkflows) for (const u of workflowChecks(text) ?? []) if (u.active) activeNow.add(u.sig);
  const afterDoc = after === null ? null : parseStructured(after, 'yaml');
  const jobsLine = afterDoc?.lineOf(['jobs']) ?? 1;
  const out: Weakening[] = [];
  const reported = new Set<string>();
  for (const b of base) {
    if (!b.active || activeNow.has(b.sig) || reported.has(b.sig)) continue;
    reported.add(b.sig);
    const inactive = current.find((u) => u.sig === b.sig && u.job === b.job) ?? current.find((u) => u.sig === b.sig);
    if (inactive?.why) {
      out.push({
        line: inactive.whyLine ?? inactive.jobLine,
        message: `\`${b.shown}\` (job ${inactive.job}) no longer fails the build: ${inactive.why}.`,
        fix: 'Let the check fail the build again and fix what it reports.',
        key: `ci:${b.sig}`,
      });
      continue;
    }
    // A check command that did not exist at the base now runs in the same job
    // (`npm run lint` replaced by `npm run check`): probably a rename or a
    // consolidation that Ubon cannot see into, so it is a warning.
    const baseSigs = new Set(base.map((u) => u.sig));
    const replacement = current.find((u) => u.job === b.job && u.active && !baseSigs.has(u.sig));
    if (replacement) {
      out.push({
        line: afterDoc?.lineOf(['jobs', b.job]) ?? jobsLine,
        message: `\`${b.shown}\` (job ${b.job}) was replaced by \`${replacement.shown}\`; Ubon cannot tell whether the new command still runs it.`,
        fix: `Check that \`${replacement.shown}\` still runs what \`${b.shown}\` ran, or restore the step.`,
        key: `ci:${b.sig}`,
        level: 'warn',
      });
      continue;
    }
    out.push({
      line: afterDoc?.lineOf(['jobs', b.job]) ?? jobsLine,
      message:
        after === null
          ? `${path} was deleted, and no other workflow runs \`${b.shown}\` (job ${b.job}).`
          : `The CI step that ran \`${b.shown}\` (job ${b.job}) was removed, and no other workflow runs it.`,
      fix: 'Restore the step so CI runs the check, or run it in another workflow.',
      key: `ci:${b.sig}`,
    });
  }
  return out;
}
