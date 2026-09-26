/**
 * Shared types for the engine, rules, reporters, and adapters.
 * Everything here is plain data so reports serialize without transformation.
 */

export type Level = 'block' | 'warn';
export type LevelSetting = Level | 'off';

export type Pack = 'secret' | 'web' | 'data' | 'llm' | 'deps' | 'agent' | 'ci' | 'integrity' | 'hygiene';

/** Where a rule looks. See plan/rules.md. */
export type RuleScope = 'file' | 'project' | 'diff' | 'hook';

export interface Position {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface TraceStep {
  line: number;
  note: string;
}

export interface Finding {
  rule: string;
  level: Level;
  /** Path relative to the scan root, with forward slashes. */
  file: string;
  range: Range;
  message: string;
  /** One line of code around the finding, with secrets masked. */
  evidence?: string;
  /** Source-to-sink steps for data-flow findings. */
  trace?: TraceStep[];
  fix: string;
  docs: string;
  fingerprint: string;
  /**
   * true: the finding is new in this change. false: it already existed at the base.
   * Absent when there is no base to compare with.
   */
  introduced?: boolean;
}

export interface SuppressedFinding extends Finding {
  suppression: {
    /** Line of the ubon-ignore comment. */
    line: number;
    reason: string;
    /** True when the comment was added in this change. */
    added?: boolean;
  };
}

export type ScopeMode = 'diff' | 'all' | 'paths' | 'staged' | 'session';

export interface ReportScope {
  mode: ScopeMode;
  /** Ref the diff is computed against, as given or resolved (for example origin/main). */
  base?: string;
  /** Resolved commit of the base, when there is one. */
  baseCommit?: string;
  /** Number of files checked. */
  files: number;
}

export interface Report {
  schemaVersion: '4.0';
  tool: { name: 'ubon'; version: string };
  scope: ReportScope;
  summary: {
    block: number;
    warn: number;
    suppressed: number;
    /** Findings left out because they are in .ubon/baseline.json. */
    baselined: number;
  };
  findings: Finding[];
  suppressed: SuppressedFinding[];
  /** Things Ubon could not check in this run, in plain words. */
  notChecked: string[];
  /** Facts about the run a reader needs, such as a fallback base. */
  notes: string[];
}
