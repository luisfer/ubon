export type RuleSeverity = 'high' | 'medium' | 'low';
export type RuleCategory = 'security' | 'accessibility' | 'links' | 'performance' | 'seo' | 'development';

export interface RuleMeta {
  id: string;
  category: RuleCategory;
  severity: RuleSeverity;
  message: string;
  fix?: string;
  helpUri?: string;
  impact?: string; // "why it matters" explanation
}

export interface PatternRule {
  ruleId: string;
  confidence: number;
  pattern: RegExp;
  message: string;
  severity: RuleSeverity;
  fix?: string;
}

export interface DetectionResult {
  line: number;
  match?: string;
  confidence?: number;
  fixEdits?: Array<{
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    replacement: string;
  }>;
}

export interface CustomDetection {
  (content: string, file: string, lines: string[]): DetectionResult[];
}

export interface RuleImpl {
  // Pattern-based detection (for simple regex rules)
  patterns?: PatternRule[];
  
  // Custom detection logic (for complex rules)
  detect?: CustomDetection;
  
  // File-level detection (checks entire file)
  fileDetect?: (content: string, file: string) => boolean;
  
  // Auto-fix capability
  autofix?: (content: string, file: string) => string;
  
  // File type restrictions
  fileTypes?: string[];
  
  // Skip patterns (files to ignore)
  skipPatterns?: RegExp[];
}

export interface Rule {
  meta: RuleMeta;
  impl: RuleImpl;
}

export interface RuleModule {
  default: Rule;
}


