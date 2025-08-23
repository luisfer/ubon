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