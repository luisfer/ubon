/**
 * Ubon programmatic API. See https://github.com/luisfer/ubon/blob/main/docs/api.md
 */

export type Level = 'block' | 'warn';
export type ScopeMode = 'diff' | 'all' | 'paths' | 'staged' | 'session';
export type Format = 'text' | 'agent' | 'json' | 'sarif' | 'markdown';

export interface Position {
  line: number;
  column: number;
}

export interface TraceStep {
  line: number;
  note: string;
}

export interface Finding {
  rule: string;
  level: Level;
  file: string;
  range: { start: Position; end: Position };
  message: string;
  evidence?: string;
  trace?: TraceStep[];
  fix: string;
  docs: string;
  fingerprint: string;
  introduced?: boolean;
}

export interface SuppressedFinding extends Finding {
  suppression: { line: number; reason: string; added?: boolean };
}

export interface ReportScope {
  mode: ScopeMode;
  base?: string;
  baseCommit?: string;
  files: number;
}

export interface Report {
  schemaVersion: '4.0';
  tool: { name: 'ubon'; version: string };
  scope: ReportScope;
  summary: { block: number; warn: number; suppressed: number; baselined: number };
  findings: Finding[];
  suppressed: SuppressedFinding[];
  notChecked: string[];
  notes: string[];
}

export interface CheckOptions {
  /** Directory to check. The git root above it becomes the root. Default: process.cwd(). */
  cwd?: string;
  /** Default 'diff'. */
  mode?: ScopeMode;
  /** Base ref for diff mode. Default: merge base with the default branch. */
  base?: string;
  /** Files for 'paths' mode, or a filter for the other modes. */
  paths?: string[];
  /** Rule selectors (IDs or `pack/*`); only these run. */
  rules?: string[];
  /** Allow registry and OSV lookups. Default: packages.online from ubon.json. */
  online?: boolean;
  /** Apply .ubon/baseline.json when present. Default true. */
  useBaseline?: boolean;
}

export interface RuleInfo {
  id: string;
  level: Level;
  scope: 'file' | 'project' | 'diff' | 'hook';
  title: string;
  summary: string;
  why: string;
  fix: string;
  cwe?: string[];
  owasp?: string[];
  references?: string[];
  levels?: string;
  docs: string;
}

export declare function check(options?: CheckOptions): Promise<Report>;
export declare function rules(): RuleInfo[];
export declare function formatReport(report: Report, format: Format, options?: { elapsedMs?: number; quiet?: boolean; color?: boolean }): string;
export declare const FORMATS: readonly Format[];
export declare const version: string;
