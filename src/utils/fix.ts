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


