import { LineCounter, type Node as YamlNode, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import type { FileInfo } from '../types.ts';

/**
 * A GitHub Actions workflow (or composite action) read with positions, so
 * rules can report the exact line of an expression inside a multi-line
 * `run:` block. Only the parts the ci rules need are modeled.
 */

export interface YamlText {
  value: string;
  /** 1-based line where the scalar starts (the `|` line for block scalars). */
  line: number;
  /** Offset of the scalar's first character, and of the end of its value. */
  start: number;
  end: number;
}

export interface Step {
  index: number;
  line: number;
  name: string | null;
  uses: YamlText | null;
  run: YamlText | null;
  with: Map<string, YamlText>;
  env: Map<string, YamlText>;
  if: string | null;
  workingDirectory: string | null;
}

export interface Permissions {
  /** 'write-all', 'read-all', or null for a map. */
  preset: string | null;
  scopes: Map<string, { value: string; line: number }>;
  line: number;
}

export interface Job {
  id: string;
  name: string | null;
  line: number;
  if: string | null;
  /** Jobs this one waits for (`needs:`). */
  needs: string[];
  /** A reusable workflow the job calls (`uses:` at job level). */
  uses: string | null;
  env: Map<string, YamlText>;
  permissions: Permissions | null;
  environment: boolean;
  steps: Step[];
  /** The job's YAML source. */
  source: string;
}

export interface Workflow {
  path: string;
  /** 'workflow' for .github/workflows files, 'action' for composite actions. */
  kind: 'workflow' | 'action';
  name: string | null;
  /** Event names in `on:`; null when they cannot be read. */
  triggers: Set<string> | null;
  /** The raw `on:` value, for trigger options (workflow_run.workflows). */
  on: unknown;
  env: Map<string, YamlText>;
  permissions: Permissions | null;
  jobs: Job[];
  lineAt(offset: number): number;
}

export const WORKFLOW_PATH = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
export const ACTION_PATH = /(^|\/)action\.ya?ml$/;

/** Workflows GitHub runs are at the repository root; nested ones are templates or vendored copies. */
export function workflowStanding(file: FileInfo): 'skip' | 'nested' | 'normal' {
  if (file.generated || file.contexts.has('test')) return 'skip';
  if (!WORKFLOW_PATH.test(file.path) && !ACTION_PATH.test(file.path)) return 'skip';
  if (WORKFLOW_PATH.test(file.path) && !file.path.startsWith('.github/')) return 'nested';
  if (file.contexts.has('example')) return 'nested';
  return 'normal';
}

function pairValue(node: unknown, key: string): YamlNode | null {
  if (!isMap(node)) return null;
  for (const item of node.items) {
    if (isPair(item) && isScalar(item.key) && String(item.key.value) === key) return (item.value as YamlNode | null) ?? null;
  }
  return null;
}

function pairKeyLine(node: unknown, key: string, lc: LineCounter): number | null {
  if (!isMap(node)) return null;
  for (const item of node.items) {
    if (isPair(item) && isScalar(item.key) && String(item.key.value) === key) {
      const start = item.key.range?.[0];
      return start === undefined ? null : lc.linePos(start).line;
    }
  }
  return null;
}

function textOf(node: YamlNode | null, lc: LineCounter): YamlText | null {
  if (!node || !isScalar(node) || node.value === null || node.value === undefined) return null;
  const range = node.range;
  if (!range) return null;
  return { value: String(node.value), line: lc.linePos(range[0]).line, start: range[0], end: range[1] };
}

function stringOf(node: YamlNode | null): string | null {
  if (!node || !isScalar(node) || node.value === null || node.value === undefined) return null;
  return String(node.value);
}

function envOf(node: YamlNode | null, lc: LineCounter): Map<string, YamlText> {
  const out = new Map<string, YamlText>();
  if (!isMap(node)) return out;
  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    const t = textOf(item.value as YamlNode | null, lc);
    if (t) out.set(String(item.key.value), t);
  }
  return out;
}

function permissionsOf(node: YamlNode | null, keyLine: number | null, lc: LineCounter): Permissions | null {
  if (!node) return null;
  const line = keyLine ?? 1;
  if (isScalar(node)) return { preset: String(node.value), scopes: new Map(), line };
  if (!isMap(node)) return null;
  const scopes = new Map<string, { value: string; line: number }>();
  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    const v = stringOf(item.value as YamlNode | null);
    const start = item.key.range?.[0];
    if (v !== null) scopes.set(String(item.key.value), { value: v, line: start === undefined ? line : lc.linePos(start).line });
  }
  return { preset: null, scopes, line };
}

function stepsOf(node: YamlNode | null, lc: LineCounter): Step[] {
  if (!isSeq(node)) return [];
  const out: Step[] = [];
  node.items.forEach((item, index) => {
    if (!isMap(item)) return;
    const start = item.range?.[0];
    const withNode = pairValue(item, 'with');
    const withMap = new Map<string, YamlText>();
    if (isMap(withNode)) {
      for (const p of withNode.items) {
        if (!isPair(p) || !isScalar(p.key)) continue;
        const t = textOf(p.value as YamlNode | null, lc);
        if (t) withMap.set(String(p.key.value), t);
      }
    }
    out.push({
      index,
      line: start === undefined ? 1 : lc.linePos(start).line,
      name: stringOf(pairValue(item, 'name')),
      uses: textOf(pairValue(item, 'uses'), lc),
      run: textOf(pairValue(item, 'run'), lc),
      with: withMap,
      env: envOf(pairValue(item, 'env'), lc),
      if: stringOf(pairValue(item, 'if')),
      workingDirectory: stringOf(pairValue(item, 'working-directory')),
    });
  });
  return out;
}

function triggersOf(on: unknown): Set<string> | null {
  if (typeof on === 'string') return new Set([on]);
  if (Array.isArray(on)) return new Set(on.filter((x): x is string => typeof x === 'string'));
  if (on && typeof on === 'object') return new Set(Object.keys(on));
  return null;
}

export function parseWorkflow(path: string, text: string): Workflow | null {
  if (text.length > 2 * 1024 * 1024) return null;
  const lc = new LineCounter();
  let doc;
  try {
    doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false, strict: false, prettyErrors: false });
  } catch {
    return null;
  }
  const root = doc.contents;
  if (!isMap(root)) return null;
  const kind = WORKFLOW_PATH.test(path) ? 'workflow' : 'action';
  let on: unknown;
  try {
    const onNode = pairValue(root, 'on') ?? pairValue(root, 'true');
    on = onNode ? (onNode as { toJSON(): unknown }).toJSON() : undefined;
  } catch {
    on = undefined;
  }
  const jobs: Job[] = [];
  if (kind === 'workflow') {
    const jobsNode = pairValue(root, 'jobs');
    if (isMap(jobsNode)) {
      for (const item of jobsNode.items) {
        if (!isPair(item) || !isScalar(item.key) || !isMap(item.value)) continue;
        const jobNode = item.value;
        const start = item.key.range?.[0];
        const needsNode = pairValue(jobNode, 'needs');
        const needs = isSeq(needsNode)
          ? needsNode.items.map((n) => stringOf(n as YamlNode)).filter((n): n is string => n !== null)
          : stringOf(needsNode) !== null
            ? [stringOf(needsNode) as string]
            : [];
        const range = jobNode.range;
        jobs.push({
          id: String(item.key.value),
          name: stringOf(pairValue(jobNode, 'name')),
          line: start === undefined ? 1 : lc.linePos(start).line,
          if: stringOf(pairValue(jobNode, 'if')),
          needs,
          uses: stringOf(pairValue(jobNode, 'uses')),
          env: envOf(pairValue(jobNode, 'env'), lc),
          permissions: permissionsOf(pairValue(jobNode, 'permissions'), pairKeyLine(jobNode, 'permissions', lc), lc),
          environment: pairValue(jobNode, 'environment') !== null,
          steps: stepsOf(pairValue(jobNode, 'steps'), lc),
          source: range ? text.slice(range[0], range[1]) : '',
        });
      }
    }
  } else {
    // Composite action: runs.steps
    const runs = pairValue(root, 'runs');
    if (isMap(runs) && stringOf(pairValue(runs, 'using')) === 'composite') {
      jobs.push({
        id: '(composite)',
        name: null,
        line: 1,
        if: null,
        needs: [],
        uses: null,
        env: new Map(),
        permissions: null,
        environment: false,
        steps: stepsOf(pairValue(runs, 'steps'), lc),
        source: '',
      });
    }
  }
  return {
    path,
    kind,
    name: stringOf(pairValue(root, 'name')),
    triggers: kind === 'workflow' ? triggersOf(on) : null,
    on,
    env: envOf(pairValue(root, 'env'), lc),
    permissions: permissionsOf(pairValue(root, 'permissions'), pairKeyLine(root, 'permissions', lc), lc),
    jobs,
    lineAt: (offset: number) => lc.linePos(offset).line,
  };
}

/** Parse once per file per run: several ci rules read the same workflow. */
const cache = new Map<string, { text: string; workflow: Workflow | null }>();

export function workflowFor(path: string, text: string): Workflow | null {
  const hit = cache.get(path);
  if (hit && hit.text === text) return hit.workflow;
  const workflow = parseWorkflow(path, text);
  if (cache.size > 200) cache.clear();
  cache.set(path, { text, workflow });
  return workflow;
}

// ---------------------------------------------------------------------------
// Expressions: ${{ ... }}

export interface ExpressionAt {
  /** The text between ${{ and }}, trimmed. */
  expr: string;
  offset: number;
  line: number;
}

/** Every ${{ ... }} in a scalar, with the line of each one in the file. */
export function expressionsIn(text: string, scalar: YamlText, lineAt: (offset: number) => number): ExpressionAt[] {
  const source = text.slice(scalar.start, scalar.end);
  const out: ExpressionAt[] = [];
  const re = /\$\{\{([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const offset = scalar.start + m.index;
    out.push({ expr: (m[1] ?? '').trim(), offset, line: lineAt(offset) });
  }
  if (out.length === 0 && scalar.value.includes('${{')) {
    // Escaped in the YAML source (for example \x24{{ in a double-quoted string): report at the scalar.
    for (const e of scalar.value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) out.push({ expr: (e[1] ?? '').trim(), offset: scalar.start, line: scalar.line });
  }
  return out;
}

type ExprNode =
  | { kind: 'path'; path: string }
  | { kind: 'call'; name: string; args: ExprNode[] }
  | { kind: 'literal' }
  | { kind: 'bool' }
  | { kind: 'or' | 'and'; left: ExprNode; right: ExprNode };

/** A small parser for GitHub Actions expressions (enough to follow values, not to evaluate them). */
export function parseExpression(input: string): ExprNode | null {
  const tokens = input.match(/'(?:[^']|'')*'|[A-Za-z_][\w-]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||[()[\].,!<>*]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const parseOr = (): ExprNode => {
    let left = parseAnd();
    while (peek() === '||') {
      next();
      left = { kind: 'or', left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): ExprNode => {
    let left = parseCompare();
    while (peek() === '&&') {
      next();
      left = { kind: 'and', left, right: parseCompare() };
    }
    return left;
  };
  const parseCompare = (): ExprNode => {
    let left = parseUnary();
    while (peek() === '==' || peek() === '!=' || peek() === '<' || peek() === '>' || peek() === '<=' || peek() === '>=') {
      next();
      parseUnary();
      left = { kind: 'bool' };
    }
    return left;
  };
  const parseUnary = (): ExprNode => {
    if (peek() === '!') {
      next();
      parseUnary();
      return { kind: 'bool' };
    }
    return parsePrimary();
  };
  const parsePrimary = (): ExprNode => {
    const t = next();
    if (t === undefined) return { kind: 'literal' };
    let node: ExprNode;
    if (t === '(') {
      node = parseOr();
      if (peek() === ')') next();
    } else if (t.startsWith("'") || /^\d/.test(t) || t === 'true' || t === 'false' || t === 'null') {
      node = { kind: 'literal' };
    } else if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        next();
        const args: ExprNode[] = [];
        while (peek() !== undefined && peek() !== ')') {
          args.push(parseOr());
          if (peek() === ',') next();
          else break;
        }
        if (peek() === ')') next();
        node = { kind: 'call', name: t.toLowerCase(), args };
      } else node = { kind: 'path', path: t };
    } else return { kind: 'literal' };
    // Property access and indexes.
    while (peek() === '.' || peek() === '[') {
      if (peek() === '.') {
        next();
        const prop = next();
        if (node.kind === 'path' && prop !== undefined) node = { kind: 'path', path: `${node.path}.${prop}` };
      } else {
        next();
        const start = i;
        const inner = parseOr();
        if (peek() === ']') next();
        const literal = i - start === 1 ? tokens[start] : undefined;
        const seg = literal && literal.startsWith("'") ? literal.slice(1, -1) : '*';
        if (node.kind === 'path') node = { kind: 'path', path: `${node.path}.${seg}` };
        void inner;
      }
    }
    return node;
  };
  try {
    const node = parseOr();
    return node;
  } catch {
    return null;
  }
}

const PR_EVENTS = ['pull_request', 'pull_request_target', 'pull_request_review', 'pull_request_review_comment'];

/**
 * Fields of the github context that the person who opens an issue, a pull
 * request, a comment, or a commit controls. `samples` name the fields, so
 * that toJSON() of an object that contains them (github.event.issue) counts.
 */
const ATTACKER_FIELDS: Array<{ pattern: RegExp; samples: string[]; who: string; events: string[] }> = [
  { pattern: /^github\.event\.issue\.(title|body)$/, samples: ['github.event.issue.title'], who: 'the issue author', events: ['issues', 'issue_comment'] },
  {
    pattern: /^github\.event\.pull_request\.(title|body|head\.ref|head\.label|head\.repo\.default_branch)$/,
    samples: ['github.event.pull_request.title', 'github.event.pull_request.head.ref'],
    who: 'the pull request author',
    events: PR_EVENTS,
  },
  {
    pattern: /^github\.event\.comment\.body$/,
    samples: ['github.event.comment.body'],
    who: 'the commenter',
    events: ['issue_comment', 'pull_request_review_comment', 'commit_comment', 'discussion_comment'],
  },
  { pattern: /^github\.event\.review\.body$/, samples: ['github.event.review.body'], who: 'the reviewer', events: ['pull_request_review'] },
  { pattern: /^github\.event\.review_comment\.body$/, samples: ['github.event.review_comment.body'], who: 'the reviewer', events: ['pull_request_review_comment'] },
  { pattern: /^github\.event\.discussion\.(title|body)$/, samples: ['github.event.discussion.title'], who: 'the discussion author', events: ['discussion', 'discussion_comment'] },
  { pattern: /^github\.event\.pages\.\*\.page_name$/, samples: ['github.event.pages.*.page_name'], who: 'wiki editors', events: ['gollum'] },
  { pattern: /^github\.event\.commits\.\*\.(message|author\.[\w*]+)$/, samples: ['github.event.commits.*.message'], who: 'the commit author', events: ['push'] },
  { pattern: /^github\.event\.head_commit\.(message|author\.[\w*]+)$/, samples: ['github.event.head_commit.message'], who: 'the commit author', events: ['push'] },
  { pattern: /^github\.head_ref$/, samples: ['github.head_ref'], who: 'the pull request author', events: PR_EVENTS },
  {
    pattern: /^github\.event\.workflow_run\.(head_branch|display_title|head_commit\.(message|author\.[\w*]+))$/,
    samples: ['github.event.workflow_run.head_branch', 'github.event.workflow_run.head_commit.message'],
    who: 'the author of the triggering branch',
    events: ['workflow_run'],
  },
  {
    pattern: /^github\.event\.workflow_run\.pull_requests\.\*\.head\.ref$/,
    samples: ['github.event.workflow_run.pull_requests.*.head.ref'],
    who: 'the pull request author',
    events: ['workflow_run'],
  },
  { pattern: /^github\.event\.release\.(name|body)$/, samples: ['github.event.release.name'], who: 'the release author', events: ['release'] },
];

export interface Taint {
  /** The attacker-controlled field, e.g. github.event.issue.title. */
  field: string;
  who: string;
  events: string[];
}

function fieldTaint(path: string): Taint | null {
  for (const f of ATTACKER_FIELDS) if (f.pattern.test(path)) return { field: path, who: f.who, events: f.events };
  return null;
}

/** An object that contains attacker fields (github.event, github.event.issue), dumped whole by toJSON(). */
function objectTaint(path: string): Taint | null {
  const prefix = `${path}.`;
  const hits = ATTACKER_FIELDS.filter((f) => f.samples.some((s) => s.startsWith(prefix)));
  if (hits.length === 0) return null;
  const whos = new Set(hits.map((h) => h.who));
  return { field: path, who: whos.size === 1 ? (hits[0] as { who: string }).who : 'the author of the event', events: [...new Set(hits.flatMap((h) => h.events))] };
}

const BOOLEAN_FUNCTIONS = new Set(['contains', 'startswith', 'endswith', 'success', 'always', 'failure', 'cancelled', 'hashfiles']);

/** Attacker-controlled values that an expression can evaluate to. */
export function taintsOf(node: ExprNode | null, env?: (name: string) => Taint[]): Taint[] {
  if (!node) return [];
  switch (node.kind) {
    case 'path': {
      const t = fieldTaint(node.path);
      if (t) return [t];
      const m = /^env\.([\w-]+)$/.exec(node.path);
      if (m && env) return env(m[1] as string);
      return [];
    }
    case 'call': {
      if (BOOLEAN_FUNCTIONS.has(node.name)) return [];
      if (node.name === 'tojson') {
        const arg = node.args[0];
        if (arg?.kind === 'path') {
          const obj = objectTaint(arg.path);
          if (obj) return [obj];
        }
      }
      return node.args.flatMap((a) => taintsOf(a, env));
    }
    case 'or':
      return [...taintsOf(node.left, env), ...taintsOf(node.right, env)];
    case 'and':
      return taintsOf(node.right, env);
    default:
      return [];
  }
}

/** Taints of every expression inside a string value (an env value such as "${{ github.event.issue.title }}"). */
export function taintsInText(value: string, env?: (name: string) => Taint[]): Taint[] {
  const out: Taint[] = [];
  for (const m of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) out.push(...taintsOf(parseExpression((m[1] ?? '').trim()), env));
  return out;
}

/** Events that run with the fork's own restrictions (read-only token, no secrets). */
export const UNPRIVILEGED_EVENTS = new Set(['pull_request', 'pull_request_review', 'pull_request_review_comment']);

/**
 * How much an attacker gains from a field in this workflow: 'none' when no
 * trigger fills it, 'low' when only fork-restricted pull_request events do,
 * 'high' otherwise (including reusable workflows and composite actions, whose
 * caller decides the event).
 */
export function exposureOf(taint: Taint, workflow: Workflow, callerTriggers?: Set<string> | null, runsOn?: (event: string) => boolean): 'none' | 'low' | 'high' {
  // Composite actions run with their caller's event; without a known caller the risk is unknown.
  const triggers = workflow.kind === 'action' ? callerTriggers ?? null : workflow.triggers;
  if (triggers === null) return workflow.kind === 'action' ? 'low' : 'high';
  if (triggers.has('workflow_call')) return 'high';
  const relevant = taint.events.filter((e) => triggers.has(e) && (workflow.kind === 'action' || !runsOn || runsOn(e)));
  if (relevant.length === 0) return 'none';
  return relevant.every((e) => UNPRIVILEGED_EVENTS.has(e)) ? 'low' : 'high';
}

/**
 * Events a composite action runs on: the triggers of the repository's
 * workflows that use it (`uses: ./path/to/action`), plus events its own
 * conditions test for (`github.event_name == 'pull_request_target'`).
 * Null when neither says anything.
 */
export function compositeActionTriggers(actionPath: string, text: string, project: { files: readonly string[]; read(path: string): string | null }): Set<string> | null {
  const out = new Set<string>();
  const dir = actionPath.includes('/') ? actionPath.slice(0, actionPath.lastIndexOf('/')) : '';
  if (dir) {
    const ref = `./${dir}`;
    for (const file of project.files) {
      if (!WORKFLOW_PATH.test(file) || !file.startsWith('.github/')) continue;
      const source = project.read(file);
      if (!source || !source.includes(ref)) continue;
      const wf = workflowFor(file, source);
      if (!wf?.triggers) continue;
      const calls = wf.jobs.some((j) => j.steps.some((s) => (s.uses?.value.trim().replace(/\/$/, '') ?? '') === ref));
      if (calls) for (const t of wf.triggers) out.add(t);
    }
  }
  for (const m of text.matchAll(/github\.event_name\s*==\s*'([a-z_]+)'/g)) out.add(m[1] as string);
  return out.size > 0 ? out : null;
}

const SAME_REPO =
  /head\.repo\.full_name\s*==\s*github\.repository\b|github\.repository\s*==\s*github\.event\.pull_request\.head\.repo\.full_name\b|head\.repo\.fork\s*==\s*false\b|^!\s*github\.event\.pull_request\.head\.repo\.fork$|head_repository\.full_name\s*==\s*github\.repository\b|github\.repository\s*==\s*github\.event\.workflow_run\.head_repository\.full_name\b|head_repository\.fork\s*==\s*false\b|^!\s*github\.event\.workflow_run\.head_repository\.fork$/;
const MERGED = /^github\.event\.pull_request\.merged(\s*==\s*true)?$/;
const WORKFLOW_RUN_PUSH = /workflow_run\.event\s*==\s*'push'|workflow_run\.event\s*!=\s*'pull_request'/;
const APPROVAL = /author_association|github\.actor\b|triggering_actor|pull_request\.user\.login|labels\.\*\.name|github\.event\.label\.name|github\.event\.action\s*==\s*'labeled'/;

/**
 * How an `if:` condition limits a job that a privileged event triggers:
 * - 'excluded': the job does not run for those events at all;
 * - 'trusted': only same-repository or merged pull requests (or workflow_run of push events);
 * - 'approval': it depends on a label, the author's association, or the actor;
 * - 'none': nothing that stops an outside pull request.
 * `a || b` is as weak as its weakest side, `a && b` as strong as its strongest.
 */
export type Guard = 'excluded' | 'trusted' | 'approval' | 'none';

const GUARD_RANK: Record<Guard, number> = { none: 0, approval: 1, trusted: 2, excluded: 3 };

export function strongerGuard(a: Guard, b: Guard): Guard {
  return GUARD_RANK[a] >= GUARD_RANK[b] ? a : b;
}

function splitCondition(s: string, op: '||' | '&&'): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") quote = !quote;
    if (quote) continue;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && s.startsWith(op, i)) {
      out.push(s.slice(last, i).trim());
      last = i + 2;
      i++;
    }
  }
  out.push(s.slice(last).trim());
  return out;
}

function unwrapCondition(s: string): string {
  let out = s.trim();
  while (out.startsWith('(') && out.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0 && i !== out.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

function classify(expr: string, privileged: ReadonlySet<string>, depth: number): Guard {
  if (depth > 30) return 'none';
  const s = unwrapCondition(expr);
  const ors = splitCondition(s, '||');
  if (ors.length > 1) {
    const parts = ors.map((p) => classify(p, privileged, depth + 1)).filter((g) => g !== 'excluded');
    if (parts.length === 0) return 'excluded';
    return parts.reduce((a, b) => (GUARD_RANK[a] <= GUARD_RANK[b] ? a : b));
  }
  const ands = splitCondition(s, '&&');
  if (ands.length > 1) return ands.map((p) => classify(p, privileged, depth + 1)).reduce(strongerGuard);
  if (SAME_REPO.test(s) || MERGED.test(s) || WORKFLOW_RUN_PUSH.test(s)) return 'trusted';
  const eq = /^github\.event_name\s*==\s*'([a-z_]+)'$/.exec(s);
  if (eq) return privileged.has(eq[1] as string) ? 'none' : 'excluded';
  const ne = /^github\.event_name\s*!=\s*'([a-z_]+)'$/.exec(s);
  if (ne) return privileged.size === 1 && privileged.has(ne[1] as string) ? 'excluded' : 'none';
  if (s.startsWith('!')) return 'none';
  if (APPROVAL.test(s)) return 'approval';
  return 'none';
}

export function classifyCondition(condition: string | null, privileged: ReadonlySet<string>): Guard {
  if (!condition) return 'none';
  const wrapped = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(condition);
  return classify((wrapped ? wrapped[1] : condition) as string, privileged, 0);
}

/** Words that name an authorization step: authorize, check-permissions, verify-membership, approval-gate. */
const GATE_WORDS = new Set([
  'auth', 'authorize', 'authorization', 'authorized', 'authz', 'permission', 'permissions', 'perms', 'membership', 'members', 'member',
  'collaborator', 'collaborators', 'trusted', 'trust', 'approve', 'approval', 'approved', 'allowed', 'allowlist', 'gate', 'gatekeeper',
]);
const CHECK_OBJECTS = new Set(['run', 'user', 'actor', 'author', 'access', 'perm', 'perms', 'permission', 'permissions', 'org', 'maintainer', 'contributor']);
const GATE_API = /getCollaboratorPermissionLevel|\/collaborators\/[^\s/]+\/permission|checkMembershipForUser|\/orgs\/[^\s/]+\/members\/|author_association|checkCollaborator/;

function namesAGate(text: string | null): boolean {
  if (!text) return false;
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => GATE_WORDS.has(w))) return true;
  return words.some((w, i) => (w === 'check' || w === 'verify') && CHECK_OBJECTS.has(words[i + 1] ?? ''));
}

/** A job whose purpose is to decide whether the pull request may run: an authorization, membership, or approval check. */
export function isGateJob(job: Job): boolean {
  return namesAGate(job.id) || namesAGate(job.name) || namesAGate(job.uses) || GATE_API.test(job.source) || job.environment;
}

/**
 * The guard on a job, including what it inherits from the jobs it needs (a
 * job is skipped when a job it needs is skipped or fails, unless its
 * condition uses always(), failure(), or cancelled()).
 */
export function jobGuard(job: Job, jobs: readonly Job[], privileged: ReadonlySet<string>, seen: Set<string> = new Set()): Guard {
  let guard = classifyCondition(job.if, privileged);
  if (guard === 'excluded' || guard === 'trusted') return guard;
  if (job.environment) guard = strongerGuard(guard, 'approval');
  const byId = (id: string) => jobs.find((j) => j.id === id);
  const independent = job.if !== null && /\b(?:always|failure|cancelled)\s*\(/.test(job.if);
  if (!independent) {
    for (const need of job.needs) {
      if (seen.has(need)) continue;
      seen.add(need);
      const n = byId(need);
      if (!n) continue;
      guard = strongerGuard(guard, isGateJob(n) ? 'approval' : jobGuard(n, jobs, privileged, seen));
    }
  }
  for (const m of (job.if ?? '').matchAll(/needs\.([\w-]+)\.(?:outputs|result)/g)) {
    const n = byId(m[1] as string);
    if (n && isGateJob(n)) guard = strongerGuard(guard, 'approval');
  }
  return guard;
}

export function isStringMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Remove shell comments from a script (lines or trailing parts starting with #). */
export function stripShellComments(script: string): string {
  return script
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          if (ch === '\\' && quote === '"') i++;
          else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] as string)) && line[i + 1] !== '{') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Line of the first match of a pattern inside a run script, in the file. */
export function lineInScalar(text: string, scalar: YamlText, pattern: RegExp, lineAt: (offset: number) => number): number {
  const source = text.slice(scalar.start, scalar.end);
  const m = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(source);
  return m ? lineAt(scalar.start + m.index) : scalar.line;
}
