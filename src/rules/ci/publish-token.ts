import type { Rule } from '../types.ts';
import { type Job, type Step, type Workflow, type YamlText, jobGuard, lineInScalar, stripShellComments, workflowFor, workflowStanding } from './workflow.ts';

/**
 * Release workflows that are easier to hijack than they need to be:
 * - npm publish authenticated with a long-lived token from a secret instead
 *   of trusted publishing (OIDC);
 * - id-token: write in a workflow that pull requests trigger;
 * - a dependency cache restored in the job that publishes, which is how the
 *   May 2026 TanStack compromise published malware with valid provenance.
 */

const PUBLISH_COMMAND =
  /\b(?:npm|pnpm|bun)\s+(?:(?:-{1,2}[\w-]+|[\w@./-]+)\s+)*?publish\b|\byarn\s+(?:npm\s+)?publish\b|\bchangeset\s+publish\b|\blerna\s+publish\b|\bsemantic-release\b|\bnx\s+release\s+publish\b/;
const PUBLISH_ACTION = /^(?:changesets\/action|js-devtools\/npm-publish|pypa\/gh-action-pypi-publish)@/i;
const TOKEN_ENV = new Set(['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_AUTH_TOKEN', 'YARN_NPM_AUTH_TOKEN']);
const SECRET_REF = /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)([\w-]+)\s*\}\}/i;
const CACHE_ACTION = /^actions\/cache(?:\/restore)?@/i;
const SETUP_WITH_CACHE = /^actions\/setup-(?:node|python|go|java|dotnet)@/i;
const PR_EVENTS = ['pull_request', 'pull_request_target'];

interface Publish {
  step: Step;
  what: string;
  line: number;
}

function publishOf(step: Step, text: string, lineAt: (o: number) => number): Publish | null {
  const uses = step.uses?.value.trim() ?? '';
  if (PUBLISH_ACTION.test(uses)) {
    // changesets/action publishes only when it is given a publish command.
    if (/^changesets\/action@/i.test(uses) && !step.with.has('publish')) return null;
    return { step, what: uses.replace(/@.*$/, ''), line: step.uses?.line ?? step.line };
  }
  if (!step.run) return null;
  const script = stripShellComments(step.run.value);
  const m = PUBLISH_COMMAND.exec(script);
  if (!m) return null;
  return { step, what: m[0].replace(/\s+/g, ' '), line: lineInScalar(text, step.run, PUBLISH_COMMAND, lineAt) };
}

/** A registry other than npmjs.org (GitHub Packages, a private registry): those rarely support OIDC. */
function usesOtherRegistry(job: Job, workflow: Workflow): boolean {
  for (const step of job.steps) {
    const registry = step.with.get('registry-url')?.value;
    if (registry && !/registry\.npmjs\.org/.test(registry)) return true;
    const script = step.run?.value ?? '';
    const flag = /--registry[= ](\S+)/.exec(script);
    if (flag && !/registry\.npmjs\.org/.test(flag[1] as string)) return true;
  }
  for (const env of [workflow.env, job.env, ...job.steps.map((s) => s.env)]) {
    const r = env.get('NPM_CONFIG_REGISTRY') ?? env.get('npm_config_registry');
    if (r && !/registry\.npmjs\.org/.test(r.value)) return true;
  }
  return false;
}

/** The token env entry a publish step sees: step env, then job env, then workflow env. */
function tokenFor(step: Step, job: Job, workflow: Workflow): { name: string; secret: string; at: YamlText } | null {
  for (const env of [step.env, job.env, workflow.env]) {
    for (const [name, value] of env) {
      if (!TOKEN_ENV.has(name.toUpperCase())) continue;
      const m = SECRET_REF.exec(value.value);
      if (m) return { name, secret: m[1] as string, at: value };
    }
  }
  const token = step.with.get('token');
  if (token && /^js-devtools\/npm-publish@/i.test(step.uses?.value ?? '')) {
    const m = SECRET_REF.exec(token.value);
    if (m) return { name: 'token', secret: m[1] as string, at: token };
  }
  return null;
}

/** An .npmrc written with a token straight from a secret: echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" */
function npmrcToken(job: Job): { step: Step; secret: string } | null {
  for (const step of job.steps) {
    const m = step.run ? /_authToken=\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)([\w-]+)\s*\}\}/i.exec(step.run.value) : null;
    if (m) return { step, secret: m[1] as string };
  }
  return null;
}

function excludesPullRequests(condition: string | null): boolean {
  if (!condition) return false;
  const names = [...condition.matchAll(/github\.event_name\s*==\s*'([^']+)'/g)].map((m) => m[1] as string);
  if (names.length > 0 && names.every((n) => !PR_EVENTS.includes(n))) return true;
  if (/github\.event_name\s*!=\s*'pull_request(?:_target)?'/.test(condition)) return true;
  if (/startsWith\(\s*github\.ref\s*,\s*'refs\/tags\/'|github\.ref_type\s*==\s*'tag'|github\.ref\s*==\s*'refs\/tags\//.test(condition)) return true;
  return false;
}

export const publishToken: Rule = {
  meta: {
    id: 'ci/publish-token',
    level: 'warn',
    scope: 'file',
    title: 'Package publishing that a stolen token or cache can hijack',
    summary:
      'npm publish (or pnpm, yarn, changesets, semantic-release) authenticated with NODE_AUTH_TOKEN or NPM_TOKEN from a secret instead of trusted publishing; id-token: write in a workflow that pull requests trigger; a dependency cache restored in the job that publishes.',
    why: 'A long-lived npm token in CI can be stolen by any code that runs in the job and used later from anywhere; trusted publishing issues a short-lived token per run instead. A cache restored before publishing can carry files written by another workflow run, which is how the May 2026 TanStack compromise published malware with valid provenance.',
    fix: 'Publish with npm trusted publishing (OIDC, id-token: write) in a job that runs only on push, release, or workflow_dispatch, and restore no caches in that job.',
    cwe: ['CWE-522', 'CWE-829'],
    owasp: ['A03:2025'],
    levels: 'warn. Publishing to GitHub Packages or another registry set with registry-url is not reported, because those registries do not accept npm trusted publishing.',
    references: ['https://docs.npmjs.com/trusted-publishers'],
  },
  appliesTo: (file) => workflowStanding(file) !== 'skip' && /\.github\/workflows\//.test(file.path),
  text(ctx) {
    const workflow = workflowFor(ctx.file.path, ctx.text);
    if (!workflow) return;
    const reported = new Set<number>();
    const report = (line: number, message: string, fix: string, key: string) => {
      if (reported.has(line)) return;
      reported.add(line);
      ctx.report({ line, message, fix, key });
    };

    // id-token: write where pull requests run the workflow. On pull_request_target the job has the
    // base repository's rights, so any code that runs there can mint tokens. On pull_request, forks
    // get no OIDC token, so only jobs that also publish are reported (cloud logins for tests are common).
    const prTriggers = PR_EVENTS.filter((e) => workflow.triggers?.has(e));
    if (prTriggers.length > 0) {
      const target = prTriggers.includes('pull_request_target');
      const events = prTriggers.join(' and ');
      const who = target
        ? 'any pull request code that runs here (through an injection or a checkout of the head) can request OIDC tokens that trusted publishing and cloud logins accept'
        : 'a pull request from a branch of this repository can run the publish step with an OIDC token';
      const idToken = (perm: Workflow['permissions']): number | null => {
        if (!perm) return null;
        if (perm.preset === 'write-all') return perm.line;
        const scope = perm.scopes.get('id-token');
        return scope && scope.value === 'write' ? scope.line : null;
      };
      const publishesIn = (job: Job) => job.steps.some((s) => publishOf(s, ctx.text, workflow.lineAt) !== null);
      const fix = 'Grant id-token: write only to a job that runs on push, release, or workflow_dispatch, never on pull request events.';
      const top = idToken(workflow.permissions);
      // Jobs limited to members, same-repository branches, or labeled pull requests are left alone.
      const prEvents = new Set(prTriggers);
      const relevant = (job: Job) => !excludesPullRequests(job.if) && jobGuard(job, workflow.jobs, prEvents) === 'none' && (target || publishesIn(job));
      if (top !== null && workflow.jobs.some((job) => relevant(job) && job.permissions === null)) {
        report(top, `This workflow runs on ${events} and grants id-token: write, so ${who}.`, fix, 'id-token');
      } else {
        // One finding per workflow: the first job that grants it, with a count of the others.
        const jobs = workflow.jobs.filter((job) => idToken(job.permissions) !== null && relevant(job));
        const first = jobs[0];
        if (first) {
          const others = jobs.length - 1;
          const also = others > 0 ? ` (and ${others} other job${others === 1 ? '' : 's'})` : '';
          report(idToken(first.permissions) as number, `Job ${first.id}${also} runs on ${events} and grants id-token: write, so ${who}.`, fix, 'id-token');
        }
      }
    }

    for (const job of workflow.jobs) {
      const publishes = job.steps.map((s) => publishOf(s, ctx.text, workflow.lineAt)).filter((p): p is Publish => p !== null);
      if (publishes.length === 0) continue;
      const first = publishes[0] as Publish;

      // Long-lived tokens.
      if (!usesOtherRegistry(job, workflow)) {
        for (const p of publishes) {
          if (/pypi/i.test(p.what)) continue;
          const token = tokenFor(p.step, job, workflow);
          if (!token) continue;
          report(
            token.at.line,
            `${p.what} (line ${p.line}) authenticates with ${token.name} from secrets.${token.secret}, a long-lived token, instead of npm trusted publishing (OIDC).`,
            'Set up trusted publishing for the package on npmjs.com, grant id-token: write to this job, and remove the token.',
            `token:${token.name}`,
          );
        }
        const npmrc = npmrcToken(job);
        if (npmrc?.step.run) {
          const line = lineInScalar(ctx.text, npmrc.step.run, /_authToken=/, workflow.lineAt);
          report(
            line,
            `This step writes secrets.${npmrc.secret} into .npmrc for ${first.what} (line ${first.line}), a long-lived token, instead of npm trusted publishing (OIDC).`,
            'Set up trusted publishing for the package on npmjs.com, grant id-token: write to this job, and remove the token.',
            'token:npmrc',
          );
        }
      }

      // Caches restored before publishing.
      for (const step of job.steps) {
        if (step.index > first.step.index) break;
        const uses = step.uses?.value.trim() ?? '';
        let what: string | null = null;
        let line = step.uses?.line ?? step.line;
        if (CACHE_ACTION.test(uses)) what = uses.replace(/@.*$/, '');
        else if (SETUP_WITH_CACHE.test(uses)) {
          const cache = step.with.get('cache');
          if (cache && cache.value.trim() && !/^(false|none)$/i.test(cache.value.trim())) {
            what = `${uses.replace(/@.*$/, '')} cache: ${cache.value.trim()}`;
            line = cache.line;
          }
        }
        if (!what) continue;
        report(
          line,
          `This job restores a dependency cache (${what}) and then publishes (${first.what}, line ${first.line}), so a cache entry written by another workflow run can end up in the published package.`,
          'Remove the cache from the publishing job, or build in a separate job and publish only its artifact.',
          `cache:${job.id}:${step.index}`,
        );
      }
    }
  },
};
