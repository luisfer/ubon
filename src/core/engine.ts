import { resolve } from 'node:path';
import type { Node } from '@babel/types';
import { parseSource } from '../lang/parse.ts';
import { ImportMap, TaintTracker } from '../lang/js.ts';
import { isFunctionNode, walk } from '../lang/walk.ts';
import { RULES, ruleIds } from '../rules/index.ts';
import type {
  DiffContext,
  FileInfo,
  JsContext,
  JsVisitors,
  ProjectContext,
  ReportInput,
  Rule,
  ScopeFileView,
  TextContext,
} from '../rules/types.ts';
import { VERSION } from '../version.ts';
import { baselineKey, baselineKeys, loadBaseline } from './baseline.ts';
import { type UbonConfig, configuredLevel, defaultConfig, loadConfig } from './config.ts';
import { SERVER_PATH, hasGeneratedHeader, pathContexts } from './context.ts';
import { diffLines, splitLines } from './diff.ts';
import { JS_LANGS, SCRIPT_LANGS, isBinaryText, languageOf, readTextFile } from './files.ts';
import { type FindingDraft, assignFingerprints, compareFindings, createFinding, normalizeAnchor, publicFinding } from './finding.ts';
import { gitDir, listTracked, repoRoot } from './git.ts';
import { Project, hasDirective } from './project.ts';
import { type Scope, resolveScope } from './scope.ts';
import type { SessionRecord } from './session.ts';
import { type Suppression, findSuppression, parseSuppressions } from './suppress.ts';
import type { Finding, Level, Report, ScopeMode, SuppressedFinding } from './types.ts';

/**
 * The engine: resolve the scope, build file contexts, run every enabled rule
 * (one AST traversal per file), then apply suppressions, the baseline, and the
 * configured levels. Rules never see each other's findings and never throw
 * past the engine: a failing rule is reported under "not checked".
 */


/** Rules whose findings are about suppressions themselves. */
const UNSUPPRESSIBLE = new Set(['integrity/new-suppression', 'integrity/invalid-suppression', 'integrity/unused-suppression']);
export interface CheckOptions {
  /** Directory to check. The git root above it becomes the root. Default: process.cwd(). */
  cwd?: string;
  /** Default 'diff'. */
  mode?: ScopeMode;
  /** Base ref for diff mode. */
  base?: string;
  /** Files for 'paths' mode, or a filter for the other modes. */
  paths?: string[];
  /** Rule selectors (IDs or `pack/*`); only these run. */
  rules?: string[];
  /** Allow registry and OSV lookups. */
  online?: boolean;
  /** Session start record for 'session' mode (null: session without a record). */
  session?: SessionRecord | null;
  /** Mark the check as part of an agent session (affects integrity rules). */
  inSession?: boolean;
  /** Preloaded config (skips reading ubon.json). */
  config?: UbonConfig;
  /** Apply .ubon/baseline.json when present. Default true. */
  useBaseline?: boolean;
}

export interface CheckResult {
  report: Report;
  root: string;
  config: UbonConfig;
  scope: Scope;
}

export async function check(options: CheckOptions = {}): Promise<Report> {
  return (await runCheck(options)).report;
}

export async function runCheck(options: CheckOptions = {}): Promise<CheckResult> {
  const started = performance.now();
  const cwd = resolve(options.cwd ?? process.cwd());
  const gitRootPath = repoRoot(cwd);
  const root = gitRootPath ?? cwd;
  const isGit = gitRootPath !== null && gitDir(root) !== null;
  const known = ruleIds();
  const config = options.config ?? loadConfig(root, known).config;
  const mode: ScopeMode = options.mode ?? 'diff';
  const scope = resolveScope({
    root,
    git: isGit,
    mode,
    base: options.base,
    paths: options.paths,
    session: options.session,
    ignore: config.ignore,
  });
  const project = new Project(root, scope.allFiles, config.maxFileSize);
  const selected = selectRules(config, options.rules);
  const run = new Run(root, scope, project, config, selected, options.inSession ?? options.mode === 'session');
  run.execute();
  if (selected.some((r) => r.rule.online)) await run.executeOnline(options.online ?? config.packages.online);
  const report = run.finish(options.useBaseline ?? true);
  report.notes.push(...scope.notes);
  void started;
  return { report, root, config, scope };
}

interface SelectedRule {
  rule: Rule;
  /** Configured level, when the user set one. */
  level?: Level;
}

export function selectRules(config: UbonConfig, selectors?: readonly string[]): SelectedRule[] {
  const out: SelectedRule[] = [];
  for (const rule of RULES) {
    if (rule.meta.scope === 'hook') continue;
    if (selectors && selectors.length > 0 && !selectors.some((s) => selectorMatches(s, rule.meta.id))) continue;
    const configured = configuredLevel(config, rule.meta.id);
    if (configured === 'off') continue;
    out.push(configured ? { rule, level: configured } : { rule });
  }
  return out;
}

export function selectorMatches(selector: string, id: string): boolean {
  if (selector.endsWith('/*')) return id.startsWith(selector.slice(0, -1));
  return selector === id;
}

interface FileState {
  view: ScopeFileView;
  info: FileInfo;
  text: string | null;
  lines: string[];
  baseText: string | null;
  suppressions: Suppression[];
  addedLines: Set<number> | null;
}

class Run {
  private readonly drafts: FindingDraft[] = [];
  private readonly baseFingerprints = new Map<string, Set<string>>();
  private readonly files = new Map<string, FileState>();
  private readonly notChecked: string[] = [];
  private readonly failures: string[] = [];
  private readonly tooLarge: string[] = [];

  /** Lockfiles and build output are read by the rules that need them, with their own limits, so they are not listed. */
  private noteTooLarge(path: string): void {
    if (!pathContexts(path).has('generated')) this.tooLarge.push(path);
  }
  private readonly unparsable: string[] = [];
  private readonly infoCache = new Map<string, FileInfo>();
  private readonly known: ReadonlySet<string>;
  private readonly root: string;
  private readonly scope: Scope;
  private readonly project: Project;
  private readonly config: UbonConfig;
  private readonly selected: SelectedRule[];
  private readonly inSession: boolean;

  constructor(root: string, scope: Scope, project: Project, config: UbonConfig, selected: SelectedRule[], inSession: boolean) {
    this.root = root;
    this.scope = scope;
    this.project = project;
    this.config = config;
    this.selected = selected;
    this.inSession = inSession;
    this.known = ruleIds();
  }

  info(path: string, text?: string | null): FileInfo {
    const cached = this.infoCache.get(path);
    if (cached) return cached;
    const project = this.project;
    const lang = languageOf(path);
    const contexts = pathContexts(path);
    const body = text === undefined ? project.read(path) : text;
    let client: boolean | undefined;
    let server: boolean | undefined;
    const info: FileInfo = {
      path,
      lang,
      contexts,
      generated: contexts.has('generated') || (body !== null && hasGeneratedHeader(body)),
      get client() {
        if (client === undefined) client = SCRIPT_LANGS.has(lang) && project.isClient(path);
        return client;
      },
      get server() {
        if (server === undefined) server = SCRIPT_LANGS.has(lang) && project.isServer(path);
        return server;
      },
    };
    this.infoCache.set(path, info);
    return info;
  }

  private get mode(): ScopeMode {
    return this.scope.mode;
  }

  execute(): void {
    for (const view of this.scope.files) {
      if (view.status === 'deleted') continue;
      const staged = this.scope.currentText(view.path);
      let text: string | null;
      if (staged !== undefined) {
        text = staged;
        if (text !== null && Buffer.byteLength(text) > this.config.maxFileSize) {
          this.noteTooLarge(view.path);
          continue;
        }
        if (text !== null && isBinaryText(text)) continue;
      } else {
        const read = readTextFile(`${this.root}/${view.path}`, this.config.maxFileSize);
        if (!read.ok) {
          if (read.reason === 'too-large') this.noteTooLarge(view.path);
          continue;
        }
        text = read.text;
      }
      if (text === null) continue;
      this.project.prime(view.path, text);
      const baseText = view.status === 'modified' || view.status === 'renamed' ? this.scope.baseText(view.path) : null;
      const lines = splitLines(text);
      const state: FileState = {
        view,
        info: this.info(view.path, text),
        text,
        lines,
        baseText,
        suppressions: parseSuppressions(text, lines, languageOf(view.path), view.path, this.known),
        addedLines: null,
      };
      this.files.set(view.path, state);
      this.drafts.push(...this.runFileRules(state.info, text, lines, false));
      if (baseText !== null) {
        const baseDrafts = this.runFileRules(state.info, baseText, splitLines(baseText), true);
        assignFingerprints(baseDrafts);
        this.baseFingerprints.set(view.path, new Set(baseDrafts.map((d) => d.fingerprint)));
      }
    }
    this.runProjectRules();
    this.runDiffRules();
  }

  async executeOnline(enabled: boolean): Promise<void> {
    const rules = this.selected.filter((s) => s.rule.online);
    if (!enabled) {
      const relevant = rules.some((s) => s.rule.needsOnline?.(this.projectContext(s)) ?? false);
      if (relevant) this.notChecked.push('registry lookups for new packages (offline; run with --online or set packages.online)');
      return;
    }
    for (const s of rules) {
      const found: FindingDraft[] = [];
      try {
        await s.rule.online?.(this.projectContext(s, found));
      } catch (error) {
        this.notChecked.push(`${s.rule.meta.id}: ${(error as Error).message}`);
      }
      this.keepInScope(found);
    }
  }

  private keepInScope(found: FindingDraft[]): void {
    const scopeSet = new Set(this.scope.files.map((f) => f.path));
    for (const f of found) if (scopeSet.has(f.file)) this.drafts.push(f);
  }

  // -------------------------------------------------------------------------
  // File rules

  private runFileRules(info: FileInfo, text: string, lines: string[], isBase: boolean): FindingDraft[] {
    const out: FindingDraft[] = [];
    const applicable = this.selected.filter((s) => (s.rule.js || s.rule.text) && (!s.rule.appliesTo || safeApplies(s.rule, info)));
    if (applicable.length === 0) return out;
    const makeReport = (s: SelectedRule) => (input: ReportInput) => {
      const draft = createFinding(s.rule.meta, info.path, input, lines[input.line - 1] ?? '');
      draft.origin = 'file';
      out.push(draft);
    };
    for (const s of applicable) {
      if (!s.rule.text) continue;
      const unreadable = (reason: string) => {
        if (!isBase && !this.unparsable.some((u) => u === info.path || u.startsWith(`${info.path} (`))) this.unparsable.push(`${info.path} (${reason})`);
      };
      const ctx: TextContext = { config: this.config, project: this.project, mode: this.mode, session: this.inSession, file: info, text, lines, report: makeReport(s), unreadable };
      try {
        s.rule.text(ctx);
      } catch (error) {
        if (!isBase) this.failure(s.rule.meta.id, info.path, error);
      }
    }
    const jsRules = applicable.filter((s) => s.rule.js);
    if (jsRules.length > 0 && SCRIPT_LANGS.has(info.lang)) this.runJsRules(info, text, lines, jsRules, makeReport, isBase);
    return out;
  }

  private runJsRules(
    info: FileInfo,
    text: string,
    lines: string[],
    rules: SelectedRule[],
    makeReport: (s: SelectedRule) => (input: ReportInput) => void,
    isBase: boolean,
  ): void {
    const parsed = parseSource(text, info.lang);
    if (parsed.failed && !isBase) this.unparsable.push(info.path);
    const serverActionsModule = JS_LANGS.has(info.lang) && hasDirective(text, 'use server');
    const routeFile = SERVER_PATH.test(info.path) || /(^|\/)(routes|pages\/api)\//.test(info.path);
    for (const block of parsed.blocks) {
      if (block.errors > 0 && !isBase && !this.unparsable.includes(info.path)) this.unparsable.push(`${info.path} (partial)`);
      const imports = new ImportMap(block.program);
      const taint = new TaintTracker(imports, { serverActionsModule, routeFile });
      let parents: readonly Node[] = [];
      const handlers = new Map<string, Array<{ id: string; fn: (node: any) => void }>>();
      const disabled = new Set<string>();
      for (const s of rules) {
        const report = makeReport(s);
        const ctx: JsContext = {
          config: this.config,
          project: this.project,
          mode: this.mode,
          session: this.inSession,
          file: info,
          text,
          program: block.program,
          side: block.side,
          imports,
          taint,
          get parents() {
            return parents;
          },
          report(node: Node, input) {
            const loc = node.loc;
            report({
              ...input,
              line: loc?.start.line ?? 1,
              column: (loc?.start.column ?? 0) + 1,
              endLine: loc?.end.line,
              endColumn: loc ? loc.end.column + 1 : undefined,
            });
          },
          lineText(line: number) {
            return lines[line - 1] ?? '';
          },
        };
        let visitors: JsVisitors;
        try {
          visitors = s.rule.js?.(ctx) ?? {};
        } catch (error) {
          if (!isBase) this.failure(s.rule.meta.id, info.path, error);
          continue;
        }
        for (const [type, fn] of Object.entries(visitors)) {
          if (!fn) continue;
          const list = handlers.get(type) ?? [];
          list.push({ id: s.rule.meta.id, fn });
          handlers.set(type, list);
        }
      }
      const dispatch = (key: string, node: Node) => {
        const list = handlers.get(key);
        if (!list) return;
        for (const h of list) {
          if (disabled.has(h.id)) continue;
          try {
            h.fn(node);
          } catch (error) {
            disabled.add(h.id);
            if (!isBase) this.failure(h.id, info.path, error);
          }
        }
      };
      walk(block.program.program, {
        enter: (node, p) => {
          parents = p;
          if (isFunctionNode(node)) taint.enterFunction(node as never, p);
          dispatch(node.type, node);
        },
        exit: (node, p) => {
          parents = p;
          if (node.type === 'VariableDeclarator') taint.declare(node);
          else if (node.type === 'AssignmentExpression') taint.assign(node.left, node.right);
          dispatch(`${node.type}:exit`, node);
          if (isFunctionNode(node)) taint.exitFunction();
        },
      });
      parents = [];
      dispatch('Program:exit', block.program.program);
    }
  }

  // -------------------------------------------------------------------------
  // Project rules

  private projectContext(s: SelectedRule, sink?: FindingDraft[]): ProjectContext {
    const scopeSet = new Set(this.scope.files.map((f) => f.path));
    let tracked: ReadonlySet<string> | null | undefined;
    const root = this.root;
    const self = this;
    return {
      config: this.config,
      project: this.project,
      mode: this.mode,
      session: this.inSession,
      scopeFiles: this.scope.files,
      inScope: (path) => scopeSet.has(path),
      get tracked() {
        if (tracked === undefined) tracked = self.scope.git ? listTracked(root) : null;
        return tracked;
      },
      info: (path) => this.info(path),
      read: (path) => this.files.get(path)?.text ?? this.project.read(path),
      base: (path) => this.files.get(path)?.baseText ?? this.scope.baseText(path),
      report: (path, input) => {
        const text = this.files.get(path)?.text ?? this.project.read(path) ?? '';
        const lines = this.files.get(path)?.lines ?? splitLines(text);
        const draft = createFinding(s.rule.meta, path, input, lines[input.line - 1] ?? '');
        draft.origin = 'project';
        (sink ?? this.drafts).push(draft);
      },
    };
  }

  private runProjectRules(): void {
    for (const s of this.selected) {
      if (!s.rule.project) continue;
      const found: FindingDraft[] = [];
      try {
        s.rule.project(this.projectContext(s, found));
      } catch (error) {
        this.failure(s.rule.meta.id, '(project)', error);
        continue;
      }
      this.keepInScope(found);
    }
  }

  // -------------------------------------------------------------------------
  // Diff rules

  private runDiffRules(): void {
    const diffRules = this.selected.filter((s) => s.rule.diff);
    for (const view of this.scope.files) {
      if (view.status === 'unchanged') continue;
      const state = this.files.get(view.path);
      if (view.status !== 'deleted' && !state) continue; // unreadable or too large
      const before = view.status === 'added' ? null : state?.baseText ?? this.scope.baseText(view.path);
      const after = view.status === 'deleted' ? null : state?.text ?? null;
      const { added, removed } = diffLines(before, after);
      if (state) state.addedLines = new Set(added.map((l) => l.line));
      if (diffRules.length === 0) continue;
      const info = this.info(view.path, after ?? before ?? '');
      const lines = after !== null ? state?.lines ?? splitLines(after) : splitLines(before ?? '');
      for (const s of diffRules) {
        if (s.rule.appliesTo && !safeApplies(s.rule, info)) continue;
        const ctx: DiffContext = {
          config: this.config,
          project: this.project,
          mode: this.mode,
          session: this.inSession,
          file: info,
          status: view.status,
          oldPath: view.oldPath,
          before,
          after,
          added,
          removed,
          scopeFiles: this.scope.files,
          report: (input) => {
            const draft = createFinding(s.rule.meta, view.path, input, lines[input.line - 1] ?? '');
            draft.origin = 'diff';
            this.drafts.push(draft);
          },
        };
        try {
          s.rule.diff?.(ctx);
        } catch (error) {
          this.failure(s.rule.meta.id, view.path, error);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Post-processing

  finish(useBaseline: boolean): Report {
    const levelFor = new Map(this.selected.map((s) => [s.rule.meta.id, s.level]));
    const ruleMeta = new Map(RULES.map((r) => [r.meta.id, r.meta]));

    // Suppression problems are findings too.
    const invalidRule = ruleMeta.get('integrity/invalid-suppression');
    const invalidEnabled = invalidRule && this.selected.some((s) => s.rule.meta.id === 'integrity/invalid-suppression');
    if (invalidRule && invalidEnabled) {
      for (const state of this.files.values()) {
        for (const sup of state.suppressions) {
          if (sup.valid) continue;
          this.drafts.push(
            createFinding(
              invalidRule,
              state.view.path,
              {
                line: sup.line,
                message: `This ubon-ignore comment ${sup.problem}, so it suppresses nothing.`,
                fix: 'Write it as `ubon-ignore <rule>: <who decided>: <evidence>`, or remove it.',
              },
              state.lines[sup.line - 1] ?? '',
            ),
          );
        }
      }
    }

    // Dedupe identical findings.
    const seen = new Set<string>();
    let drafts = this.drafts.filter((d) => {
      const k = `${d.rule}\0${d.file}\0${d.range.start.line}\0${d.range.start.column}\0${d.key}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Fingerprints are assigned per file.
    const byFile = new Map<string, FindingDraft[]>();
    for (const d of drafts) {
      const list = byFile.get(d.file) ?? [];
      list.push(d);
      byFile.set(d.file, list);
    }
    for (const list of byFile.values()) assignFingerprints(list);

    // New in this change, or already at the base?
    for (const d of drafts) {
      const state = this.files.get(d.file);
      const status = state?.view.status ?? this.scope.files.find((v) => v.path === d.file)?.status;
      if (!status || status === 'unchanged') continue;
      if (status === 'added' || status === 'deleted') {
        d.introduced = true;
        continue;
      }
      const baseSet = this.baseFingerprints.get(d.file);
      if (d.origin === 'diff') d.introduced = true;
      else if (d.origin === 'file' && baseSet) d.introduced = !baseSet.has(d.fingerprint);
      else {
        // Project rules: treat a finding on a line that already existed at the base as existing.
        const baseText = state?.baseText ?? null;
        d.introduced = baseText === null || !splitLines(baseText).some((l) => normalizeAnchor(l) === d.anchor);
      }
    }

    // Suppressions.
    const suppressed: SuppressedFinding[] = [];
    const used = new Set<Suppression>();
    drafts = drafts.filter((d) => {
      const state = this.files.get(d.file);
      if (!state) return true;
      // Findings about suppressions cannot be suppressed; otherwise a comment could hide its own listing.
      if (UNSUPPRESSIBLE.has(d.rule)) return true;
      const sup = findSuppression(state.suppressions, d.rule, d.range.start.line);
      if (!sup) return true;
      used.add(sup);
      const added = state.view.status === 'added' || (state.addedLines ? state.addedLines.has(sup.line) : undefined);
      suppressed.push({
        ...publicFinding(d),
        level: levelFor.get(d.rule) ?? d.level,
        suppression: added === undefined ? { line: sup.line, reason: sup.reason } : { line: sup.line, reason: sup.reason, added },
      });
      return false;
    });

    // Unused suppressions, in full audits only (other modes do not run every rule on every file).
    const unusedRule = ruleMeta.get('integrity/unused-suppression');
    if (unusedRule && this.scope.mode === 'all' && this.selected.some((s) => s.rule.meta.id === 'integrity/unused-suppression')) {
      const enabled = new Set(this.selected.map((s) => s.rule.meta.id));
      for (const state of this.files.values()) {
        for (const sup of state.suppressions) {
          if (!sup.valid || used.has(sup) || !sup.rules.every((r) => enabled.has(r))) continue;
          const f = createFinding(
            unusedRule,
            state.view.path,
            { line: sup.line, message: `This ubon-ignore comment for ${sup.rules.join(', ')} no longer matches a finding.`, fix: 'Remove the comment.' },
            state.lines[sup.line - 1] ?? '',
          );
          assignFingerprints([f]);
          drafts.push(f);
        }
      }
    }

    // Baseline.
    let baselined = 0;
    if (useBaseline) {
      const keys = baselineKeys(loadBaseline(this.root));
      if (keys.size > 0) {
        drafts = drafts.filter((d) => {
          if (keys.has(baselineKey(d))) {
            baselined++;
            return false;
          }
          return true;
        });
      }
    }

    // Levels: configured level wins; findings that already existed at the base never block.
    const findings: Finding[] = drafts.map((d) => {
      const f = publicFinding(d);
      const configured = levelFor.get(d.rule);
      if (configured === 'block' || configured === 'warn') f.level = configured;
      if (f.level === 'block' && f.introduced === false) f.level = 'warn';
      return f;
    });
    findings.sort(compareFindings);
    suppressed.sort(compareFindings);

    if (this.tooLarge.length > 0) {
      this.notChecked.push(`${plural(this.tooLarge.length, 'file')} over the size limit (${formatBytes(this.config.maxFileSize)}): ${listSome(this.tooLarge)}`);
    }
    if (this.unparsable.length > 0) this.notChecked.push(`${plural(this.unparsable.length, 'file')} with syntax errors, checked only in part: ${listSome(this.unparsable)}`);
    if (this.failures.length > 0) this.notChecked.push(...this.failures.slice(0, 10));

    const block = findings.filter((f) => f.level === 'block').length;
    return {
      schemaVersion: '4.0',
      tool: { name: 'ubon', version: VERSION },
      scope: {
        mode: this.scope.mode,
        ...(this.scope.baseLabel ? { base: this.scope.baseLabel } : {}),
        ...(this.scope.baseCommit ? { baseCommit: this.scope.baseCommit } : {}),
        files: this.scope.files.filter((f) => f.status !== 'deleted').length,
      },
      summary: { block, warn: findings.length - block, suppressed: suppressed.length, baselined },
      findings,
      suppressed,
      notChecked: this.notChecked,
      notes: [],
    };
  }

  private failure(ruleId: string, path: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const line = `${ruleId} failed on ${path} (internal error: ${message.slice(0, 120)})`;
    if (!this.failures.includes(line)) this.failures.push(line);
    if (process.env.UBON_DEBUG) console.error(error);
  }
}

function safeApplies(rule: Rule, info: FileInfo): boolean {
  try {
    return rule.appliesTo ? rule.appliesTo(info) : true;
  } catch {
    return false;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function listSome(items: string[], max = 5): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')}, and ${items.length - max} more`;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

export { defaultConfig, ruleIds };
