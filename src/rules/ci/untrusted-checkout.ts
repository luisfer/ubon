import type { Project } from '../../core/project.ts';
import type { Rule } from '../types.ts';
import {
  type Guard,
  type Job,
  type Step,
  WORKFLOW_PATH,
  type Workflow,
  classifyCondition,
  isStringMap,
  jobGuard,
  lineInScalar,
  stripShellComments,
  strongerGuard,
  workflowFor,
  workflowStanding,
} from './workflow.ts';

/**
 * A privileged workflow (pull_request_target, workflow_run, issue_comment)
 * that checks out the pull request's code and then runs it: installs its
 * dependencies, builds it, runs its scripts, or uses a local action from it.
 * Those workflows run with the base repository's secrets and a write token,
 * so the pull request's code gets them too ("pwn request"). A reusable
 * workflow counts when a privileged workflow in the repository calls it.
 */

const PRIVILEGED = ['pull_request_target', 'workflow_run', 'issue_comment'];

/**
 * Refs that name pull request commits inside the base repository (a SHA,
 * refs/pull/N/head or /merge). A branch name (head.ref, github.head_ref,
 * workflow_run.head_branch) only finds pull request code together with the
 * fork as `repository:`; on its own it names a branch of the base repository,
 * which only people with write access can create.
 */
const UNTRUSTED_REF =
  /github\.event\.pull_request\.head\.sha\b|github\.event\.pull_request\.merge_commit_sha\b|refs\/pull\/|github\.event\.workflow_run\.head_sha\b|github\.event\.workflow_run\.pull_requests(?:\[\d+\]|\.\*)?\.head\.sha\b/;
const UNTRUSTED_REPO = /github\.event\.pull_request\.head\.repo\.(?:full_name|clone_url)\b|github\.event\.workflow_run\.head_repository\.full_name\b/;
const CLI_CHECKOUT =
  /\bgh\s+pr\s+checkout\b|\bhub\s+pr\s+checkout\b|\bgit\s+fetch\b[^\n]*\bpull\/[^\s]+\/(?:head|merge)\b|\bgit\s+(?:checkout|switch)\b[^\n]*\bpr[-_]?\$\{\{|\bgit\s+checkout\b[^\n]*\bFETCH_HEAD\b/;

/** Commands that run code from the working tree. */
const EXEC_COMMANDS: RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|run|run-script|test|t|build|exec|x|start|pack|rebuild|dlx|publish|nx|turbo|lint|tsc|vitest|jest)\b/,
  /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s*(?:$|[;&|])/,
  /\b(?:npx|pnpx|bunx)\s+\S/,
  /\bnode\s+(?!-v\b|--version\b|-e\b|-p\b|--eval\b|--print\b)[\w./-]+/,
  /\bdeno\s+(?:run|task|test)\b/,
  /\b(?:pip3?|python3?\s+-m\s+pip)\s+install\b/,
  /\bpython3?\s+(?:-m\s+(?!pip\b)\w+|(?!-)[\w./-]+\.py\b)/,
  /\b(?:pytest|tox|nox)\b|\bpoetry\s+(?:install|run|build)\b|\buv\s+(?:sync|run|build|pip\s+install)\b/,
  /(?:^|[;&|(]\s*)make\b/,
  /\bcmake\b/,
  /\bcargo\s+(?:build|test|run|check|clippy|install|bench|doc)\b/,
  /\bgo\s+(?:build|test|run|generate|vet|install)\b/,
  /(?:^|[\s;&|(])(?:\.\/)?(?:gradlew|mvnw)\b|\b(?:mvn|gradle)\s+\w/,
  /\bbundle\s+(?:install|exec)\b|\brake\b/,
  /\bcomposer\s+(?:install|update|run|test)\b/,
  /\bdotnet\s+(?:build|test|run|restore|pack|publish)\b/,
  /\bdocker\s+(?:build|compose|buildx\s+build)\b|\bdocker-compose\b/,
  /\bpre-commit\s+run\b/,
  /\bterraform\s+(?:init|plan|apply|validate)\b/,
  /(?:^|[;&|]|\$\()\s*\.{1,2}\/[\w./-]+/,
  /\b(?:bash|sh|zsh|source)\s+(?:\.\/)?[\w./-]+\.(?:sh|bash|zsh)\b/,
];

/** Installing a published tool globally does not run the checked-out code. */
const GLOBAL_INSTALL = /\b(?:npm|pnpm|bun)\s+(?:install|i|add)\b[^\n;&|]*\s(?:-g|--global)\b|\byarn\s+global\s+add\b|\bpip3?\s+install\s+(?:--user\s+)?(?!-r\b|-e\b|\.)[\w=<>~.[\]-]+(?:\s+[\w=<>~.[\]-]+)*\s*$/;

/** Steps that stop the job unless a maintainer approved the pull request (a label, a permission or membership check). */
const GATE_ACTIONS =
  /^(?:[\w.-]+\/)?(?:verify-pr-label-action|check-user-permission|action-repository-permission|repo-permission-check-action|actions-team-membership|get-user-teams-membership|require-labels?|check-labels?|label-checker|has-permission|permission-check[\w-]*|check-permissions?[\w-]*)@/i;
const GATE_SCRIPT = /getCollaboratorPermissionLevel|\/collaborators\/[^\s/]+\/permission|checkMembershipForUser|\/orgs\/[^\s/]+\/members\/|author_association/;

function isGateStep(step: Step): boolean {
  const uses = step.uses?.value.trim() ?? '';
  if (GATE_ACTIONS.test(uses)) return true;
  const script = step.run?.value ?? step.with.get('script')?.value ?? '';
  return GATE_SCRIPT.test(script) && /\bexit\s+1\b|core\.setFailed|process\.exit\(\s*1\s*\)|throw\b/.test(script);
}

/** Actions that build or run the checked-out code. */
const EXEC_ACTIONS =
  /^(?:docker\/build-push-action|github\/codeql-action\/autobuild|cypress-io\/github-action|pre-commit\/action|gradle\/gradle-build-action|bahmutov\/npm-install|borales\/actions-yarn|microsoft\/playwright-github-action|nick-fields\/retry|nick-invision\/retry)@/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `${{ x }}` alone reads as `x`; a value that mixes text and expressions is kept as written. */
function stripExpr(value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  const whole = /^\$\{\{\s*([^}]*?)\s*\}\}$/.exec(v);
  return whole ? (whole[1] as string) : v;
}

/**
 * A ref such as `github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha`
 * picks the head only for pull_request events, which are not privileged.
 */
function headOnlyForUnprivilegedEvents(value: string): boolean {
  return /github\.event_name\s*==\s*'pull_request'/.test(value) && !/pull_request_target|workflow_run|issue_comment/.test(value);
}

interface Checkout {
  step: Step;
  line: number;
  what: string;
  /** Subdirectory the code is checked out into, or null for the workspace root. */
  path: string | null;
}

function checkoutOf(step: Step, text: string, lineAt: (o: number) => number): Checkout | null {
  const uses = step.uses?.value ?? '';
  if (/^actions\/checkout@/i.test(uses)) {
    const ref = step.with.get('ref');
    const repo = step.with.get('repository');
    const refUntrusted = ref !== undefined && UNTRUSTED_REF.test(ref.value) && !headOnlyForUnprivilegedEvents(ref.value);
    const repoUntrusted = repo !== undefined && UNTRUSTED_REPO.test(repo.value) && !headOnlyForUnprivilegedEvents(repo.value);
    if (!refUntrusted && !repoUntrusted) return null;
    const at = (refUntrusted || !repo ? ref : repo) as { line: number; value: string };
    const what = repoUntrusted && repo ? `${stripExpr(repo.value)}${ref ? ` at ${stripExpr(ref.value)}` : ''}` : stripExpr(at.value);
    const path = step.with.get('path')?.value.trim().replace(/^\.\//, '').replace(/\/$/, '') || null;
    return { step, line: at.line, what, path };
  }
  if (step.run) {
    const script = stripShellComments(step.run.value);
    const m = CLI_CHECKOUT.exec(script);
    if (m) {
      return { step, line: lineInScalar(text, step.run, CLI_CHECKOUT, lineAt), what: stripExpr(m[0]), path: step.workingDirectory?.replace(/^\.\//, '') ?? null };
    }
  }
  return null;
}

/**
 * True when a step runs something inside the checkout directory: its working
 * directory, `cd dir`, `--prefix dir`, `make -C dir`, a local action under
 * it, or a script file from it. Passing `dir/...` as an argument to a
 * trusted script only reads it.
 */
function referencesPath(step: Step, path: string): boolean {
  const p = escapeRegExp(path);
  if (step.workingDirectory && new RegExp(`^(?:\\./)?${p}(?:/|$)`).test(step.workingDirectory.trim())) return true;
  const uses = step.uses?.value ?? '';
  if (new RegExp(`^\\./${p}(?:/|$)`).test(uses)) return true;
  if (!step.run) return false;
  const target = `["']?(?:\\./)?${p}(?:/|["'\\s;&|)]|$)`;
  const re = new RegExp(
    [
      `\\b(?:cd|pushd)\\s+${target}`,
      `--(?:prefix|cwd|dir|directory|working-directory|project|manifest-path)[= ]${target}`,
      `\\s-C\\s+${target}`,
      `(?:^|[;&|(]\\s*|\\b(?:node|bash|sh|zsh|python3?|tsx|ts-node|bun|source)\\s+|\\bdeno\\s+run\\s+)["']?(?:\\./)?${p}/`,
    ].join('|'),
    'm',
  );
  return re.test(stripShellComments(step.run.value));
}

interface Exec {
  what: string;
  /** Offset of the command inside the script, for commands in run scripts. */
  at: number;
  pattern: RegExp | null;
}

function execOf(step: Step): Exec | null {
  const uses = step.uses?.value.trim() ?? '';
  if (uses.startsWith('./')) return { what: `uses: ${uses}`, at: 0, pattern: null };
  if (EXEC_ACTIONS.test(uses)) return { what: `uses: ${uses.replace(/@.*$/, '')}`, at: 0, pattern: null };
  if (!step.run) return null;
  const script = stripShellComments(step.run.value);
  let offset = 0;
  for (const line of script.split('\n')) {
    if (!GLOBAL_INSTALL.test(line)) {
      for (const re of EXEC_COMMANDS) {
        const m = re.exec(line);
        if (m) return { what: m[0].trim().replace(/^[;&|(]\s*/, '').slice(0, 60), at: offset + m.index, pattern: re };
      }
    }
    offset += line.length + 1;
  }
  return null;
}

/** Names of the workflows that trigger a workflow_run workflow. */
function triggeringWorkflows(workflow: Workflow): string[] | null {
  if (!isStringMap(workflow.on)) return null;
  const wr = workflow.on.workflow_run;
  if (!isStringMap(wr)) return null;
  const list = wr.workflows;
  if (Array.isArray(list)) return list.filter((x): x is string => typeof x === 'string');
  if (typeof list === 'string') return [list];
  return null;
}

function rootWorkflows(project: Project, except: string): Workflow[] {
  const out: Workflow[] = [];
  for (const file of project.files) {
    if (!WORKFLOW_PATH.test(file) || file === except || !file.startsWith('.github/')) continue;
    const text = project.read(file);
    if (!text) continue;
    const wf = workflowFor(file, text);
    if (wf) out.push(wf);
  }
  return out;
}

/** True when every workflow that can trigger this one is found and none runs on pull requests. */
function triggeredOnlyByTrustedEvents(workflow: Workflow, project: Project): boolean {
  const names = triggeringWorkflows(workflow);
  if (!names || names.length === 0) return false;
  const found = new Map<string, Workflow>();
  for (const other of rootWorkflows(project, workflow.path)) {
    const name = other.name ?? other.path;
    if (names.includes(name)) found.set(name, other);
  }
  if (found.size !== names.length) return false;
  for (const other of found.values()) {
    if (other.triggers === null) return false;
    if (['pull_request', 'pull_request_review', 'pull_request_review_comment'].some((e) => other.triggers?.has(e))) return false;
  }
  return true;
}

interface Privilege {
  events: Set<string>;
  /** For reusable workflows: the weakest guard among the privileged callers. */
  callerGuard: Guard | null;
}

/** The privileged events a workflow runs on, directly or through the workflows that call it. */
function privilegeOf(workflow: Workflow, project: Project): Privilege | null {
  const own = new Set(PRIVILEGED.filter((t) => workflow.triggers?.has(t)));
  if (own.size > 0) return { events: own, callerGuard: null };
  if (!workflow.triggers?.has('workflow_call') || !workflow.path.startsWith('.github/')) return null;
  const ref = `./${workflow.path}`;
  const events = new Set<string>();
  let callerGuard: Guard | null = null;
  for (const caller of rootWorkflows(project, workflow.path)) {
    const callerEvents = new Set(PRIVILEGED.filter((t) => caller.triggers?.has(t)));
    if (callerEvents.size === 0) continue;
    for (const job of caller.jobs) {
      if ((job.uses ?? '').replace(/@.*$/, '').trim() !== ref) continue;
      const guard = jobGuard(job, caller.jobs, callerEvents);
      if (guard === 'excluded') continue;
      for (const e of callerEvents) events.add(e);
      // The weakest caller decides: any unguarded caller exposes the workflow.
      if (callerGuard === null || strongerGuard(callerGuard, guard) === callerGuard) callerGuard = guard;
    }
  }
  return events.size > 0 ? { events, callerGuard } : null;
}

export const untrustedCheckout: Rule = {
  meta: {
    id: 'ci/untrusted-checkout',
    level: 'block',
    scope: 'file',
    title: 'Pull request code run in a privileged workflow',
    summary:
      'A pull_request_target, workflow_run, or issue_comment workflow (or a reusable workflow one of them calls) that checks out the pull request head (head.sha, head.ref, refs/pull/N/merge, workflow_run.head_sha) and then installs dependencies, builds, runs scripts, or uses a local action from it in the same job.',
    why: 'These workflows run with the base repository\'s secrets and a token that can write to it. Install scripts, build scripts, and local actions in the pull request run with that access, so anyone who opens a pull request can steal the secrets or push to the repository.',
    fix: 'Build and test pull request code in a pull_request workflow without secrets, and pass results to the privileged workflow as artifacts; if you must check out the head here, do not run anything from it.',
    cwe: ['CWE-829', 'CWE-94'],
    owasp: ['A03:2025'],
    levels:
      'block; warn when the job waits for approval (a label, author_association, or actor check, a deployment environment, or a job it needs that checks permissions or membership), and for workflows outside the repository root .github/workflows. Jobs limited to same-repository or merged pull requests, and workflow_run workflows triggered only by workflows without pull request events, are skipped.',
    references: ['https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/'],
  },
  appliesTo: (file) => workflowStanding(file) !== 'skip' && /\.github\/workflows\//.test(file.path),
  text(ctx) {
    if (!/pull_request_target|workflow_run|issue_comment|workflow_call/.test(ctx.text)) return;
    const standing = workflowStanding(ctx.file);
    const workflow = workflowFor(ctx.file.path, ctx.text);
    if (!workflow || !workflow.triggers) return;
    const privilege = privilegeOf(workflow, ctx.project);
    if (!privilege) return;
    let trustedRun: boolean | null = null;
    for (const job of workflow.jobs as Job[]) {
      for (let i = 0; i < job.steps.length; i++) {
        const step = job.steps[i] as Step;
        const checkout = checkoutOf(step, ctx.text, workflow.lineAt);
        if (!checkout) continue;
        let found: { step: Step; what: string; line: number } | null = null;
        for (let j = checkout.step.uses ? i + 1 : i; j < job.steps.length; j++) {
          const later = job.steps[j] as Step;
          if (j > i && /^actions\/checkout@/i.test(later.uses?.value ?? '') && checkoutOf(later, ctx.text, workflow.lineAt) === null) {
            // A later checkout of a trusted ref into the same place replaces the code.
            const laterPath = later.with.get('path')?.value.trim().replace(/^\.\//, '').replace(/\/$/, '') || null;
            if (laterPath === checkout.path) break;
          }
          const exec = execOf(later);
          if (!exec) continue;
          if (checkout.path && !referencesPath(later, checkout.path)) continue;
          if (j === i && exec.pattern && step.run) {
            // gh pr checkout and a command in the same script: the command must come after the checkout.
            const script = stripShellComments(step.run.value);
            const co = script.search(/\bgh\s+pr\s+checkout\b|\bhub\s+pr\s+checkout\b|\bgit\s+(?:checkout|switch|fetch)\b/);
            if (exec.at < co) continue;
          }
          const line = later.run && exec.pattern ? lineInScalar(ctx.text, later.run, exec.pattern, workflow.lineAt) : (later.uses?.line ?? later.line);
          found = { step: later, what: exec.what, line };
          break;
        }
        if (!found) continue;
        let guard = jobGuard(job, workflow.jobs, privilege.events);
        guard = strongerGuard(guard, classifyCondition(step.if, privilege.events));
        guard = strongerGuard(guard, classifyCondition(found.step.if, privilege.events));
        if (privilege.callerGuard) guard = strongerGuard(guard, privilege.callerGuard);
        if (job.steps.slice(0, found.step.index).some(isGateStep)) guard = strongerGuard(guard, 'approval');
        if (guard === 'trusted' || guard === 'excluded') break;
        if (privilege.events.size === 1 && privilege.events.has('workflow_run')) {
          trustedRun ??= triggeredOnlyByTrustedEvents(workflow, ctx.project);
          if (trustedRun) break;
        }
        const approval = guard === 'approval';
        const level = approval || standing !== 'normal' ? 'warn' : 'block';
        const events = [...privilege.events].join(' and ');
        const via = privilege.callerGuard !== null ? ' (called from a workflow in this repository)' : '';
        ctx.report({
          line: checkout.line,
          level,
          message: `This ${events} job${via} checks out the pull request's code (${checkout.what}) and then runs it (${found.what}, line ${found.line}) with the repository's secrets and write token${approval ? '; the job has an approval check, so make sure it covers every commit it runs' : ''}.`,
          key: `${job.id}:${checkout.step.index}`,
        });
        break;
      }
    }
  },
};
