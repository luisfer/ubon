import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FixEdit, ScanResult } from '../types';

interface FileEdits {
  filePath: string;
  edits: FixEdit[];
}

export interface ApplyFixesResult {
  changedFiles: string[];
  appliedEditCount: number;
}

export interface FixPreview {
  file: string;
  ruleId: string;
  line: number;
  before: string;
  after: string;
}

export function collectFixEdits(results: ScanResult[]): FileEdits[] {
  const map = new Map<string, FixEdit[]>();
  for (const r of results) {
    if (!r.fixEdits || r.fixEdits.length === 0) continue;
    for (const e of r.fixEdits) {
      if (!map.has(e.file)) map.set(e.file, []);
      map.get(e.file)!.push(e);
    }
  }
  return Array.from(map.entries()).map(([filePath, edits]) => ({ filePath, edits }));
}

export function applyFixes(results: ScanResult[], directory: string, dryRun: boolean): ApplyFixesResult {
  const filesWithEdits = collectFixEdits(results);
  let appliedEditCount = 0;
  const changedFiles: string[] = [];

  for (const { filePath, edits } of filesWithEdits) {
    try {
      const abs = join(directory, filePath);
      const original = readFileSync(abs, 'utf-8');
      const updated = applyEditsToContent(original, edits);
      if (updated !== original) {
        if (!dryRun) writeFileSync(abs, updated, 'utf-8');
        appliedEditCount += edits.length;
        changedFiles.push(filePath);
      }
    } catch {
      // skip file if cannot read/write
    }
  }

  return { changedFiles, appliedEditCount };
}

function applyEditsToContent(content: string, edits: FixEdit[]): string {
  // Convert line/column to absolute indices, and apply in reverse order
  const lineStarts = computeLineStarts(content);
  const normalized = edits
    .map(e => ({
      start: positionToIndex(e.startLine, e.startColumn, lineStarts),
      end: positionToIndex(e.endLine, e.endColumn, lineStarts),
      replacement: e.replacement
    }))
    .sort((a, b) => b.start - a.start);

  let updated = content;
  for (const e of normalized) {
    updated = updated.slice(0, e.start) + e.replacement + updated.slice(e.end);
  }
  return updated;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function positionToIndex(line: number, column: number, lineStarts: number[]): number {
  const lineIndex = Math.max(1, line) - 1;
  const lineStart = lineStarts[Math.min(lineIndex, lineStarts.length - 1)] ?? 0;
  return lineStart + Math.max(0, column - 1);
}

/**
 * Generate a preview of fixes without applying them
 */
export function previewFixes(results: ScanResult[], directory: string): FixPreview[] {
  const previews: FixPreview[] = [];
  const filesWithEdits = collectFixEdits(results);

  for (const { filePath, edits } of filesWithEdits) {
    try {
      const abs = join(directory, filePath);
      const content = readFileSync(abs, 'utf-8');
      const lines = content.split('\n');

      for (const edit of edits) {
        const lineIndex = edit.startLine - 1;
        if (lineIndex < 0 || lineIndex >= lines.length) continue;

        const beforeLine = lines[lineIndex];
        
        // Find the result that generated this edit
        const result = results.find(r => 
          r.fixEdits?.some(e => 
            e.file === edit.file && 
            e.startLine === edit.startLine
          )
        );

        // Compute what the line would look like after the fix
        let afterLine = beforeLine;
        if (edit.startLine === edit.endLine) {
          // Single-line edit
          const startCol = Math.max(0, edit.startColumn - 1);
          const endCol = Math.max(startCol, edit.endColumn - 1);
          afterLine = beforeLine.slice(0, startCol) + edit.replacement + beforeLine.slice(endCol);
        } else {
          // Multi-line edit - show just the replacement
          afterLine = edit.replacement.split('\n')[0] || '(multi-line change)';
        }

        previews.push({
          file: filePath,
          ruleId: result?.ruleId || 'unknown',
          line: edit.startLine,
          before: beforeLine.trim(),
          after: afterLine.trim()
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return previews;
}

/**
 * Print fix previews in a diff-like format
 */
export function printFixPreviews(previews: FixPreview[]): void {
  if (previews.length === 0) {
    console.log('No auto-fixable issues found.');
    return;
  }

  console.log(`\n🔧 Fix Preview (${previews.length} changes)\n`);
  console.log('The following changes would be applied:\n');

  // Group by file
  const byFile = new Map<string, FixPreview[]>();
  for (const p of previews) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file)!.push(p);
  }

  for (const [file, filePreview] of byFile) {
    console.log(`📄 ${file}`);
    for (const p of filePreview) {
      console.log(`  Line ${p.line} [${p.ruleId}]:`);
      console.log(`  - ${p.before}`);
      console.log(`  + ${p.after}`);
      console.log('');
    }
  }

  console.log('Run with --apply-fixes to apply these changes.');
}
