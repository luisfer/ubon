import { createHash } from 'node:crypto';
import { docsUrl, type ReportInput, type RuleMeta } from '../rules/types.ts';
import { maskSecrets, safeText } from './mask.ts';
import type { Finding } from './types.ts';

/**
 * Findings are created here and nowhere else. Evidence, messages, and trace
 * notes are masked at creation, so a raw secret never sits on a finding
 * object and cannot reach any output, cache, or log.
 */

export interface FindingDraft extends Finding {
  /** Normalized, masked line text used for fingerprints. Removed before output. */
  anchor: string;
  key: string;
  /** Which kind of check produced it: per-file checks can be compared with a run on the base. */
  origin?: 'file' | 'project' | 'diff';
}

export function createFinding(meta: RuleMeta, file: string, input: ReportInput, lineText: string): FindingDraft {
  const line = Math.max(1, Math.floor(input.line));
  const trimmedStart = lineText.length - lineText.trimStart().length;
  const column = Math.max(1, Math.floor(input.column ?? trimmedStart + 1));
  const endLine = Math.max(line, Math.floor(input.endLine ?? line));
  const endColumn = Math.max(1, Math.floor(input.endColumn ?? (endLine === line ? Math.max(column, lineText.length + 1) : 1)));
  const evidenceSource = input.evidence ?? lineText.trim();
  const finding: FindingDraft = {
    rule: meta.id,
    level: input.level ?? meta.level,
    file,
    range: { start: { line, column }, end: { line: endLine, column: endColumn } },
    message: safeText(input.message, 400),
    fix: safeText(input.fix ?? meta.fix, 400),
    docs: docsUrl(meta.id),
    fingerprint: '',
    anchor: normalizeAnchor(lineText),
    key: input.key ? safeText(input.key, 120) : '',
  };
  if (evidenceSource) finding.evidence = safeText(evidenceSource, 200);
  if (input.trace && input.trace.length > 0) {
    finding.trace = input.trace.slice(0, 12).map((step) => ({ line: Math.max(1, Math.floor(step.line)), note: safeText(step.note, 160) }));
  }
  return finding;
}

/** Masked, whitespace-collapsed line text: stable when code moves, never contains a secret. */
export function normalizeAnchor(lineText: string): string {
  return maskSecrets(lineText).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Stable fingerprints: rule, file, the normalized line text, the finding key,
 * and the index among identical findings. Line numbers are not part of it, so
 * a finding keeps its fingerprint when code above it changes.
 */
export function assignFingerprints(findings: FindingDraft[], pathFor: (f: FindingDraft) => string = (f) => f.file): void {
  const counts = new Map<string, number>();
  const ordered = [...findings].sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column);
  for (const f of ordered) {
    const base = `${f.rule}\0${pathFor(f)}\0${f.anchor}\0${f.key}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    f.fingerprint = createHash('sha256').update(`${base}\0${n}`).digest('hex').slice(0, 16);
  }
}

/** Remove internal fields before a finding leaves the engine. */
export function publicFinding(draft: FindingDraft): Finding {
  const { anchor: _anchor, key: _key, origin: _origin, ...rest } = draft;
  return rest;
}

export function compareFindings(a: Finding, b: Finding): number {
  const level = (l: Finding['level']) => (l === 'block' ? 0 : 1);
  return (
    level(a.level) - level(b.level) ||
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    a.range.start.line - b.range.start.line ||
    a.range.start.column - b.range.start.column ||
    (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)
  );
}
