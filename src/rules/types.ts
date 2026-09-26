import type { File as BabelFile, Node } from '@babel/types';
import type { UbonConfig } from '../core/config.ts';
import type { PathContext } from '../core/context.ts';
import type { Lang } from '../core/files.ts';
import type { Project } from '../core/project.ts';
import type { Level, Pack, RuleScope, ScopeMode, TraceStep } from '../core/types.ts';
import type { ImportMap, TaintTracker } from '../lang/js.ts';

/**
 * The internal rule API. A rule is metadata plus one or more check functions:
 *
 * - `js`: visitors over the JavaScript/TypeScript AST. All enabled rules share
 *   one traversal per file. The factory is called once per file, so closures
 *   can hold per-file state.
 * - `text`: a check over the raw text of any file (secrets, SQL, YAML, agent files).
 * - `project`: runs once per check with access to every file in the project.
 * - `diff`: runs once per changed file with the base and current content.
 *
 * Hook rules (`scope: 'hook'`) have no check function here; the hook runtime
 * calls their logic directly. They are registered for `ubon rules`, `ubon
 * explain`, and config validation.
 */

export interface RuleMeta {
  /** `pack/kebab-name`. Never reused. */
  id: string;
  level: Level;
  scope: RuleScope;
  /** Short title for lists, in sentence case. */
  title: string;
  /** One sentence: what the rule catches. */
  summary: string;
  /** One to three sentences: why it matters. */
  why: string;
  /** One sentence: the default fix. */
  fix: string;
  cwe?: string[];
  owasp?: string[];
  references?: string[];
  /** Finer description of levels when a rule reports at more than one level. */
  levels?: string;
}

export interface FileInfo {
  /** Path relative to the root, with forward slashes. */
  path: string;
  lang: Lang;
  contexts: ReadonlySet<PathContext>;
  /** The file's code ships to the browser (client module graph, SPA source, client script blocks). */
  client: boolean;
  /** The file only runs on the server (route handlers, 'use server', server-only, framework conventions). */
  server: boolean;
  /** Lockfiles, build output, and files with a generated header. */
  generated: boolean;
}

export interface ReportInput {
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  /** Override the rule's default level for this finding (for rules with several levels). */
  level?: Level;
  /** Override the rule's default fix. */
  fix?: string;
  trace?: TraceStep[];
  /** Evidence text. Defaults to the source line. Masked before it is stored. */
  evidence?: string;
  /** Distinguishes findings of the same rule on the same line (for fingerprints and dedupe). */
  key?: string;
}

interface BaseContext {
  readonly config: UbonConfig;
  readonly project: Project;
  readonly mode: ScopeMode;
  /** True when the check runs for an agent session (Stop hook or a session-scoped check). */
  readonly session: boolean;
}

export interface TextContext extends BaseContext {
  readonly file: FileInfo;
  readonly text: string;
  /** Lines without line terminators. Index 0 is line 1. */
  readonly lines: readonly string[];
  report(input: ReportInput): void;
}

export interface JsContext extends BaseContext {
  readonly file: FileInfo;
  readonly text: string;
  readonly program: BabelFile;
  /** Where the current script block runs. Plain JS/TS files are 'both'. */
  readonly side: 'server' | 'client' | 'both';
  readonly imports: ImportMap;
  readonly taint: TaintTracker;
  /** Ancestors of the node being visited, outermost first. */
  readonly parents: readonly Node[];
  /** Report at a node's location. */
  report(node: Node, input: Omit<ReportInput, 'line' | 'column' | 'endLine' | 'endColumn'>): void;
  lineText(line: number): string;
}

export type JsVisitor = (node: any) => void;
/** Keys are Babel node types, optionally with ':exit', plus 'Program:exit' for end-of-file work. */
export type JsVisitors = Record<string, JsVisitor | undefined>;

export interface ScopeFileView {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unchanged';
  oldPath?: string;
}

export interface ProjectContext extends BaseContext {
  /** Files in scope for this check (changed files in diff mode, every file with --all). */
  readonly scopeFiles: readonly ScopeFileView[];
  inScope(path: string): boolean;
  /** Tracked files (git ls-files), or null outside git. */
  readonly tracked: ReadonlySet<string> | null;
  info(path: string): FileInfo;
  read(path: string): string | null;
  /** Content at the base, for changed files. */
  base(path: string): string | null;
  report(path: string, input: ReportInput): void;
}

export interface LineChange {
  /** 1-based line number (in the current file for added lines, in the base for removed lines). */
  line: number;
  text: string;
}

export interface DiffContext extends BaseContext {
  readonly file: FileInfo;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly oldPath?: string;
  /** Base content, or null for added files. */
  readonly before: string | null;
  /** Current content, or null for deleted files. */
  readonly after: string | null;
  readonly added: readonly LineChange[];
  readonly removed: readonly LineChange[];
  /** Files in scope, to look up related changes (for example a deleted test's module). */
  readonly scopeFiles: readonly ScopeFileView[];
  report(input: ReportInput): void;
}

export interface Rule {
  meta: RuleMeta;
  /** Which files the `js`, `text`, and `diff` checks run on. Defaults to every file. */
  appliesTo?(file: FileInfo): boolean;
  js?(ctx: JsContext): JsVisitors;
  text?(ctx: TextContext): void;
  project?(ctx: ProjectContext): void;
  diff?(ctx: DiffContext): void;
  /** Network part of a rule (registry or OSV lookups). Runs only when lookups are allowed. */
  online?(ctx: ProjectContext): Promise<void>;
  /** True when the network part would have something to look up; used to say what was not checked offline. */
  needsOnline?(ctx: ProjectContext): boolean;
}

export function packOf(id: string): Pack {
  return id.slice(0, id.indexOf('/')) as Pack;
}

export function docsUrl(id: string): string {
  return `https://github.com/luisfer/ubon/blob/main/docs/rules/${id}.md`;
}
