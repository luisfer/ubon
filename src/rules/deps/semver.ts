/**
 * The part of node-semver that deciding "which version would npm install"
 * needs: parsing, comparing, and range matching with caret, tilde, x-ranges,
 * hyphen ranges, and `||`. Prereleases match a range only when a comparator
 * names the same major.minor.patch with a prerelease, as in node-semver.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

const VERSION = /^\s*[v=]*\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

export function parseVersion(text: string): SemVer | null {
  const m = VERSION.exec(text);
  if (!m) return null;
  const prerelease = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

type Op = '<' | '<=' | '>' | '>=' | '=';
interface Comparator {
  op: Op;
  version: SemVer;
}

/** A partial version: 1, 1.2, 1.2.x, *, with the missing parts as null. */
interface Partial {
  major: number | null;
  minor: number | null;
  patch: number | null;
  prerelease: Array<string | number>;
}

const PARTIAL = /^[v=]*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parsePartial(text: string): Partial | null {
  if (text === '' || text === '*' || /^[xX]$/.test(text)) return { major: null, minor: null, patch: null, prerelease: [] };
  const m = PARTIAL.exec(text);
  if (!m) return null;
  const num = (s: string | undefined) => (s === undefined || /^[xX*]$/.test(s) ? null : Number(s));
  const major = num(m[1]);
  const minor = major === null ? null : num(m[2]);
  const patch = minor === null ? null : num(m[3]);
  const prerelease = patch !== null && m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { major, minor, patch, prerelease };
}

const v = (major: number, minor: number, patch: number, prerelease: Array<string | number> = []): SemVer => ({ major, minor, patch, prerelease });
/** The lowest version of a release line, below its prereleases: 2.0.0-0. */
const floor = (major: number, minor: number, patch: number): SemVer => v(major, minor, patch, [0]);

function expand(op: string, p: Partial): Comparator[] | null {
  const { major, minor, patch, prerelease } = p;
  if (op === '^') {
    if (major === null) return [];
    const lo = v(major, minor ?? 0, patch ?? 0, prerelease);
    if (major > 0 || minor === null) return [{ op: '>=', version: lo }, { op: '<', version: floor(major + 1, 0, 0) }];
    if (minor > 0 || patch === null) return [{ op: '>=', version: lo }, { op: '<', version: floor(0, minor + 1, 0) }];
    return [{ op: '>=', version: lo }, { op: '<', version: floor(0, 0, patch + 1) }];
  }
  if (op === '~') {
    if (major === null) return [];
    const lo = v(major, minor ?? 0, patch ?? 0, prerelease);
    return [{ op: '>=', version: lo }, { op: '<', version: minor === null ? floor(major + 1, 0, 0) : floor(major, minor + 1, 0) }];
  }
  if (op === '' || op === '=') {
    if (major === null) return [];
    if (minor === null) return [{ op: '>=', version: v(major, 0, 0) }, { op: '<', version: floor(major + 1, 0, 0) }];
    if (patch === null) return [{ op: '>=', version: v(major, minor, 0) }, { op: '<', version: floor(major, minor + 1, 0) }];
    return [{ op: '=', version: v(major, minor, patch, prerelease) }];
  }
  if (major === null) return op === '<' || op === '>' ? null : [];
  if (op === '>') {
    if (minor === null) return [{ op: '>=', version: v(major + 1, 0, 0) }];
    if (patch === null) return [{ op: '>=', version: v(major, minor + 1, 0) }];
    return [{ op: '>', version: v(major, minor, patch, prerelease) }];
  }
  if (op === '>=') return [{ op: '>=', version: v(major, minor ?? 0, patch ?? 0, prerelease) }];
  if (op === '<') return [{ op: '<', version: v(major, minor ?? 0, patch ?? 0, minor === null || patch === null ? [0] : prerelease) }];
  if (op === '<=') {
    if (minor === null) return [{ op: '<', version: floor(major + 1, 0, 0) }];
    if (patch === null) return [{ op: '<', version: floor(major, minor + 1, 0) }];
    return [{ op: '<=', version: v(major, minor, patch, prerelease) }];
  }
  return null;
}

/** Parse a range into alternatives of comparator sets, or null when it is not a semver range (a dist-tag). */
export function parseRange(range: string): Comparator[][] | null {
  const alternatives = range.trim().split('||');
  const out: Comparator[][] = [];
  for (const alt of alternatives) {
    let text = alt.trim();
    const set: Comparator[] = [];
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    if (hyphen) {
      const lo = parsePartial(hyphen[1] as string);
      const hi = parsePartial(hyphen[2] as string);
      if (!lo || !hi) return null;
      const a = expand('>=', lo);
      const b = expand('<=', hi);
      if (!a || !b) return null;
      out.push([...a, ...b]);
      continue;
    }
    text = text.replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, '$1');
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const m = /^(<=|>=|<|>|=|\^|~>?)?(.*)$/.exec(token);
      const op = (m?.[1] ?? '').replace('~>', '~');
      const partial = parsePartial(m?.[2] ?? '');
      if (!partial) return null;
      const expanded = expand(op, partial);
      if (!expanded) return null;
      set.push(...expanded);
    }
    out.push(set);
  }
  return out;
}

function test(c: Comparator, version: SemVer): boolean {
  const d = compareVersions(version, c.version);
  switch (c.op) {
    case '<':
      return d < 0;
    case '<=':
      return d <= 0;
    case '>':
      return d > 0;
    case '>=':
      return d >= 0;
    default:
      return d === 0;
  }
}

function setMatches(set: Comparator[], version: SemVer): boolean {
  if (!set.every((c) => test(c, version))) return false;
  if (version.prerelease.length === 0) return true;
  // A prerelease matches only if a comparator names the same release line with a prerelease.
  return set.some(
    (c) =>
      c.version.prerelease.length > 0 &&
      !(c.version.prerelease.length === 1 && c.version.prerelease[0] === 0 && c.op === '<') &&
      c.version.major === version.major &&
      c.version.minor === version.minor &&
      c.version.patch === version.patch,
  );
}

export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const sets = parseRange(range);
  if (!parsed || !sets) return false;
  return sets.some((set) => setMatches(set, parsed));
}

export function maxSatisfying(versions: readonly string[], range: string): string | null {
  const sets = parseRange(range);
  if (!sets) return null;
  let best: { text: string; parsed: SemVer } | null = null;
  for (const text of versions) {
    const parsed = parseVersion(text);
    if (!parsed || !sets.some((set) => setMatches(set, parsed))) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { text, parsed };
  }
  return best?.text ?? null;
}

/** True when the text is a semver range (or version) rather than a dist-tag such as "next". */
export function isRange(text: string): boolean {
  return parseRange(text) !== null;
}
