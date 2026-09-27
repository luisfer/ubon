import { isRecord, jsonKeyLines } from './text.ts';
import { type ParsedSpec, parseDependencySpec } from './spec.ts';

/** package.json dependency entries with line numbers, and what changed since the base. */

export const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
export type DepField = (typeof DEP_FIELDS)[number];

export interface DependencyEntry {
  name: string;
  /** The value as written, for example "^4.17.21" or "workspace:*". */
  value: string;
  field: DepField;
  /** 1-based line of the entry in package.json. */
  line: number;
  spec: ParsedSpec;
}

export interface Manifest {
  name?: string;
  dependencies: DependencyEntry[];
  raw: Record<string, unknown>;
}

export function isManifestPath(path: string): boolean {
  return /(^|\/)package\.json$/.test(path) && !path.includes('node_modules/');
}

/** Parse package.json text; null when it is not a JSON object. */
export function parseManifest(text: string): Manifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const keyLines = jsonKeyLines(text);
  const dependencies: DependencyEntry[] = [];
  for (const field of DEP_FIELDS) {
    const block = raw[field];
    if (!isRecord(block)) continue;
    for (const [name, value] of Object.entries(block)) {
      if (typeof value !== 'string') continue;
      const line = keyLines.get(`${field}\0${name}`) ?? lineOfKey(text, name) ?? 1;
      dependencies.push({ name, value, field, line, spec: parseDependencySpec(name, value) });
    }
  }
  return { ...(typeof raw.name === 'string' ? { name: raw.name } : {}), dependencies, raw };
}

function lineOfKey(text: string, key: string): number | null {
  const needle = `${JSON.stringify(key)}:`;
  const lines = text.split('\n');
  const index = lines.findIndex((l) => l.includes(needle));
  return index === -1 ? null : index + 1;
}

export interface DependencyChange {
  entry: DependencyEntry;
  /** 'added': the name is new to this package.json. 'changed': the value changed. */
  kind: 'added' | 'changed';
  /** The value at the base, for changed entries. */
  before?: string;
}

/**
 * Entries added or changed since the base. A name that moves between
 * dependency fields with the same value is not a change; peer dependencies are
 * left out because they install nothing by themselves.
 */
export function dependencyChanges(before: string | null, after: string): DependencyChange[] {
  const current = parseManifest(after);
  if (!current) return [];
  const base = before === null ? null : parseManifest(before);
  if (before !== null && !base) return []; // the base was not valid JSON: nothing reliable to compare
  const baseValues = new Map<string, Set<string>>();
  for (const e of base?.dependencies ?? []) {
    const set = baseValues.get(e.name) ?? new Set<string>();
    set.add(e.value.trim());
    baseValues.set(e.name, set);
  }
  const out: DependencyChange[] = [];
  const seen = new Set<string>();
  for (const entry of current.dependencies) {
    if (entry.field === 'peerDependencies') continue;
    const key = `${entry.name}\0${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const previous = baseValues.get(entry.name);
    if (!previous) {
      out.push({ entry, kind: 'added' });
    } else if (!previous.has(entry.value.trim())) {
      const before = [...previous][0] as string;
      // An alias that now points at another package installs a new package.
      const samePackage = parseDependencySpec(entry.name, before).name === entry.spec.name;
      out.push({ entry, kind: samePackage ? 'changed' : 'added', before });
    }
  }
  return out;
}
