export interface ScanResult {
  type: 'error' | 'warning' | 'info';
  category: 'security' | 'links' | 'performance' | 'accessibility' | 'seo';
  message: string;
  file?: string;
  line?: number;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  severity: 'high' | 'medium' | 'low';
  ruleId: string;
  confidence: number; // 0.0 - 1.0 likelihood this is a true issue
  match?: string; // the matched snippet used for fingerprinting
  fingerprint?: string; // Stable fingerprint for suppression/baseline
  fix?: string;
  fixEdits?: FixEdit[]; // optional machine-actionable edits
  helpUri?: string; // optional documentation URL for this rule
}

export interface ScanOptions {
  directory: string;
  port?: number;
  skipBuild?: boolean;
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
  // Configurable scanning behavior
  minConfidence?: number; // 0.0 - 1.0; default undefined means no filter
  enabledRules?: string[]; // if provided, only include these ruleIds
  disabledRules?: string[]; // exclude these ruleIds
  failOn?: 'none' | 'warning' | 'error'; // CLI gating threshold
  // Baseline
  baselinePath?: string; // path to baseline file; default .ubon.baseline.json in directory
  updateBaseline?: boolean; // write current findings to baseline and exit
  useBaseline?: boolean; // apply baseline to filter findings (default true)
  // Changed-files mode
  changedFiles?: string[]; // limit scanning to these relative file paths
  gitChangedSince?: string; // use git diff --name-only <ref> to populate changedFiles
  // Profile selection
  profile?: 'auto' | 'react' | 'next' | 'python' | 'vue';
  // History scanning
  gitHistoryDepth?: number; // number of commits to search for secrets
  // Internal crawler (opt-in)
  crawlInternal?: boolean;
  crawlStartUrl?: string;
  crawlDepth?: number;
  crawlTimeoutMs?: number;
  // Performance mode
  fast?: boolean;
  skipPatterns?: string[];
  maxFileSize?: number;
  // Focus filters (human-friendly)
  focusCritical?: boolean; // only show severity high
  focusSecurity?: boolean; // only category security
  focusNew?: boolean; // only issues not in baseline (applied post-baseline)
  detailed?: boolean; // show all, including lower-confidence
  quickTopN?: number; // for 'quick' command, top N critical issues
  // Output mode
  json?: boolean; // whether JSON output is desired
  color?: 'auto' | 'always' | 'never'; // colorized output mode
  groupBy?: 'category' | 'file' | 'rule' | 'severity'; // how to group results
  minSeverity?: 'low' | 'medium' | 'high'; // minimum severity filter
  maxIssues?: number; // limit number of results shown
  showContext?: boolean; // show code context around findings
  explain?: boolean; // show "why it matters" explanations
}

export interface FixEdit {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  replacement: string;
}

export interface Scanner {
  name: string;
  scan(options: ScanOptions): Promise<ScanResult[]>;
}