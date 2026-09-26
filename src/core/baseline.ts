import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding } from './types.ts';

/**
 * `.ubon/baseline.json`: fingerprints of findings that already existed when
 * the baseline was recorded. It holds rule IDs, paths, and fingerprints only,
 * never code or secrets. Findings in the baseline are left out of reports.
 */

export const BASELINE_FILE = '.ubon/baseline.json';

export interface BaselineEntry {
  rule: string;
  file: string;
  fingerprint: string;
}

export interface Baseline {
  version: 1;
  findings: BaselineEntry[];
}

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineError';
  }
}

export function loadBaseline(root: string): Baseline | null {
  const path = join(root, BASELINE_FILE);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new BaselineError(`${BASELINE_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { findings?: unknown }).findings)) {
    throw new BaselineError(`${BASELINE_FILE} has an unknown format. Run \`ubon baseline\` to record it again.`);
  }
  const findings = ((raw as { findings: unknown[] }).findings).filter(
    (e): e is BaselineEntry =>
      !!e && typeof e === 'object' && typeof (e as BaselineEntry).rule === 'string' && typeof (e as BaselineEntry).file === 'string' && typeof (e as BaselineEntry).fingerprint === 'string',
  );
  return { version: 1, findings };
}

export function baselineFrom(findings: readonly Finding[]): Baseline {
  const entries = findings.map((f) => ({ rule: f.rule, file: f.file, fingerprint: f.fingerprint }));
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.fingerprint < b.fingerprint ? -1 : 1));
  const unique = entries.filter((e, i) => i === 0 || e.fingerprint !== entries[i - 1]?.fingerprint || e.file !== entries[i - 1]?.file);
  return { version: 1, findings: unique };
}

export function writeBaseline(root: string, baseline: Baseline): string {
  const path = join(root, BASELINE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return path;
}

export function baselineKeys(baseline: Baseline | null): Set<string> {
  return new Set((baseline?.findings ?? []).map((e) => `${e.rule}\0${e.file}\0${e.fingerprint}`));
}

export function baselineKey(f: Pick<Finding, 'rule' | 'file' | 'fingerprint'>): string {
  return `${f.rule}\0${f.file}\0${f.fingerprint}`;
}
