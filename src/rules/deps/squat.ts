/**
 * Typosquat matching against a list of popular npm names. Pure functions with
 * no data import, so scripts/gen-popular-packages.mjs can use them too; the
 * bundled list is wired in by popular.ts.
 *
 * A name matches when it is not a known name itself and either follows a
 * confusable pattern of a popular name (scope dropped, separators changed, a
 * js affix, a doubled or dropped letter, a homoglyph such as rn for m), or is
 * one edit (insert, delete, replace, or swap two neighbors) away from one.
 * Pure one-edit matches need both names to have at least five characters,
 * because short names are one edit away from many real packages.
 */

export type SquatPattern = 'scope-dropped' | 'separator' | 'affix' | 'doubled-letter' | 'homoglyph' | 'swap' | 'one-edit';

export interface SquatMatch {
  name: string;
  /** The popular package the name imitates. */
  target: string;
  pattern: SquatPattern;
}

export interface SquatIndex {
  names: readonly string[];
  /** Lowercased popular name to rank (position in the list). */
  rank: Map<string, number>;
  /** Legitimate names that look like a popular one; never reported. */
  known: Set<string>;
  /** Unscoped names by length, for the one-edit search. */
  byLength: Map<number, string[]>;
  /** Unscoped name with separators removed to the best-ranked name. */
  squashed: Map<string, string>;
  /** Distinctive name parts of scoped packages (for the scope-dropped pattern) to the best-ranked name. */
  scopedNamePart: Map<string, string>;
  /** Every name part of scoped packages (except @types), to name a better target for a name that already matched. */
  anyScopedNamePart: Map<string, string>;
  scoped: string[];
}

export function buildSquatIndex(popular: readonly string[], lookalikes: readonly string[] = []): SquatIndex {
  const names = popular.filter(Boolean);
  const rank = new Map<string, number>();
  const byLength = new Map<number, string[]>();
  const squashed = new Map<string, string>();
  const scopedNamePart = new Map<string, string>();
  const anyScopedNamePart = new Map<string, string>();
  const scoped: string[] = [];
  names.forEach((raw, i) => {
    const name = raw.toLowerCase();
    if (rank.has(name)) return;
    rank.set(name, i);
    if (name.startsWith('@')) {
      scoped.push(name);
      return;
    }
    const key = squash(name);
    if (!squashed.has(key)) squashed.set(key, name);
    const list = byLength.get(name.length) ?? [];
    list.push(name);
    byLength.set(name.length, list);
  });
  for (const name of scoped) {
    const slash = name.indexOf('/');
    const scope = name.slice(1, slash);
    const part = name.slice(slash + 1);
    // @types/x pairs with x by design, and generic or plugin-style parts (core,
    // react-switch) name many unrelated packages outside the scope.
    if (scope !== 'types' && isDistinctive(part, rank) && !scopedNamePart.has(part)) scopedNamePart.set(part, name);
    if (scope !== 'types' && !anyScopedNamePart.has(part)) anyScopedNamePart.set(part, name);
  }
  const known = new Set(lookalikes.map((n) => n.toLowerCase()));
  return { names, rank, known, byLength, squashed, scopedNamePart, anyScopedNamePart, scoped };
}

function squash(name: string): string {
  return name.replace(/[-_.]/g, '');
}

/**
 * A scoped package's name part that is specific enough to recognize without
 * its scope: long, with a separator, and not a plugin-style name that starts
 * with a popular package (react-switch, vue-router-mock).
 */
function isDistinctive(part: string, rank: ReadonlyMap<string, number>): boolean {
  if (part.length < 8 || !/[-.]/.test(part) || !/[a-z]{3}/.test(part)) return false;
  const head = part.split(/[-.]/)[0] ?? '';
  return !rank.has(head);
}

const AFFIXES: Array<{ re: RegExp; strip: (n: string) => string }> = [
  { re: /^[a-z0-9].*[-.]js$/, strip: (n) => n.slice(0, -3) },
  { re: /^js-./, strip: (n) => n.slice(3) },
  { re: /^[a-z0-9].{2,}js$/, strip: (n) => n.slice(0, -2) },
];

const HOMOGLYPHS: Array<[string, string]> = [
  ['rn', 'm'],
  ['vv', 'w'],
  ['cl', 'd'],
  ['1', 'l'],
  ['1', 'i'],
  ['0', 'o'],
  ['5', 's'],
];

export interface Edit {
  kind: 'insert' | 'delete' | 'replace' | 'swap';
  /** Position of the edit in the candidate (insert, replace, swap) or the target (delete). */
  at: number;
}

/**
 * The single edit that turns `target` into `candidate`, or null when they are
 * equal or differ by more than one edit (optimal string alignment distance).
 */
export function singleEdit(candidate: string, target: string): Edit | null {
  const a = candidate;
  const b = target;
  if (a === b || Math.abs(a.length - b.length) > 1) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return { kind: 'replace', at: i };
    if (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) return { kind: 'swap', at: i };
    return null;
  }
  if (a.length === b.length + 1) return a.slice(i + 1) === b.slice(i) ? { kind: 'insert', at: i } : null;
  return a.slice(i) === b.slice(i + 1) ? { kind: 'delete', at: i } : null;
}

/**
 * The part of a hyphenated name that holds position `at`: "stringify" for
 * position 4 of "qs-stringify".
 */
function partAt(name: string, at: number): string {
  const start = name.lastIndexOf('-', at - 1) + 1;
  const end = name.indexOf('-', at);
  return name.slice(start, end === -1 ? name.length : end);
}

/**
 * Edits that usually mean a different, legitimate package rather than a typo.
 * `rank` is the popular list: an edit that turns one part of a hyphenated
 * name into another popular name (qs-stringify next to js-stringify) names a
 * helper of that package, not a misspelling.
 */
function isBenignEdit(candidate: string, target: string, edit: Edit, rank?: ReadonlyMap<string, number>): boolean {
  if (rank && candidate.includes('-') && edit.kind !== 'delete') {
    const part = partAt(candidate, edit.at);
    if (part.length >= 2 && part !== candidate && rank.has(part)) return true;
  }
  const c = candidate[edit.at] ?? '';
  const t = target[edit.at] ?? '';
  // Version-like digits: base62 and base64, vue2 and vue3, webpack4.
  if (edit.kind === 'replace' && /\d/.test(c) && /\d/.test(t)) return true;
  if (edit.kind === 'insert' && /\d/.test(c) && edit.at === candidate.length - 1) return true;
  if (edit.kind === 'delete' && /\d/.test(t) && edit.at === target.length - 1) return true;
  // A separator added or removed is the separator pattern, which is checked on its own.
  if ((edit.kind === 'insert' && /[-_.]/.test(c)) || (edit.kind === 'delete' && /[-_.]/.test(t))) return true;
  // Two spellings of one word: eslint-plugin-yaml and eslint-plugin-yml are both real.
  const spelling = (s: string) => s.replace(/yaml/g, 'yml').replace(/jpeg/g, 'jpg');
  return spelling(candidate) === spelling(target);
}

function isDoubledLetter(candidate: string, target: string, edit: Edit): boolean {
  if (edit.kind === 'insert') {
    const ch = candidate[edit.at];
    return ch !== undefined && /[a-z]/.test(ch) && (candidate[edit.at - 1] === ch || candidate[edit.at + 1] === ch);
  }
  if (edit.kind === 'delete') {
    const ch = target[edit.at];
    return ch !== undefined && /[a-z]/.test(ch) && (target[edit.at - 1] === ch || target[edit.at + 1] === ch);
  }
  return false;
}

/** True when the name is on the popular list or is a known legitimate lookalike. */
export function isKnownName(index: SquatIndex, name: string): boolean {
  const lower = name.toLowerCase();
  return index.rank.has(lower) || index.known.has(lower);
}

/**
 * The popular package that `input` imitates, or null. Known names never
 * match, and neither do names in the same scope as the target (only the
 * scope's owner can publish there).
 */
export function matchSquat(index: SquatIndex, input: string): SquatMatch | null {
  const name = input.trim().toLowerCase();
  if (!name || isKnownName(index, name)) return null;
  const rankOf = (target: string) => index.rank.get(target) ?? Number.MAX_SAFE_INTEGER;
  const better = (a: SquatMatch | null, b: SquatMatch): SquatMatch => (a && rankOf(a.target) <= rankOf(b.target) ? a : b);

  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash < 2) return null;
    const scope = name.slice(1, slash);
    const part = name.slice(slash + 1);
    let best: SquatMatch | null = null;
    // A typo in the scope of a popular scoped package: @bable/core for @babel/core.
    for (const target of index.scoped) {
      const tSlash = target.indexOf('/');
      if (target.slice(tSlash + 1) !== part) continue;
      const tScope = target.slice(1, tSlash);
      if (tScope === scope || tScope.length < 4) continue;
      const edit = singleEdit(scope, tScope);
      if (edit && !isBenignEdit(scope, tScope, edit)) best = better(best, { name: input, target, pattern: edit.kind === 'swap' ? 'swap' : 'one-edit' });
      else if (squash(scope) === squash(tScope)) best = better(best, { name: input, target, pattern: 'separator' });
    }
    return best;
  }

  const found = matchUnscoped(index, name, input, better);
  // A name that already looks wrong and is exactly the name part of a popular
  // scoped package that repeats its scope most likely meant that package:
  // supabase-js for @supabase/supabase-js, rather than the supabase CLI.
  const scopedTarget = found && found.pattern !== 'scope-dropped' ? index.anyScopedNamePart.get(name) : undefined;
  const scope = scopedTarget?.slice(1, scopedTarget.indexOf('/'));
  return scopedTarget && scope && name.includes(scope) ? { name: input, target: scopedTarget, pattern: 'scope-dropped' } : found;
}

function matchUnscoped(index: SquatIndex, name: string, input: string, better: (a: SquatMatch | null, b: SquatMatch) => SquatMatch): SquatMatch | null {
  // Patterns first: they are specific, so they apply to short names too.
  const squashedHit = index.squashed.get(squash(name));
  if (squashedHit && squashedHit !== name && squash(name).length >= 4) return { name: input, target: squashedHit, pattern: 'separator' };
  const scoped = index.scopedNamePart.get(name);
  if (scoped) return { name: input, target: scoped, pattern: 'scope-dropped' };
  for (const affix of AFFIXES) {
    if (!affix.re.test(name)) continue;
    const base = affix.strip(name);
    if (base.length >= 3 && index.rank.has(base)) return { name: input, target: base, pattern: 'affix' };
  }
  for (const [from, to] of HOMOGLYPHS) {
    let at = name.indexOf(from);
    while (at !== -1) {
      const variant = name.slice(0, at) + to + name.slice(at + from.length);
      if (variant.length >= 3 && index.rank.has(variant)) return { name: input, target: variant, pattern: 'homoglyph' };
      at = name.indexOf(from, at + 1);
    }
  }

  let best: SquatMatch | null = null;
  for (const len of [name.length - 1, name.length, name.length + 1]) {
    for (const target of index.byLength.get(len) ?? []) {
      const edit = singleEdit(name, target);
      if (!edit || isBenignEdit(name, target, edit, index.rank)) continue;
      if (isDoubledLetter(name, target, edit)) {
        if (target.length >= 3) best = better(best, { name: input, target, pattern: 'doubled-letter' });
        continue;
      }
      if (Math.min(name.length, target.length) < 5) continue;
      best = better(best, { name: input, target, pattern: edit.kind === 'swap' ? 'swap' : 'one-edit' });
    }
  }
  return best;
}

/** How the name relates to its target, for messages: "is lodash with two letters swapped". */
export function describeSquat(m: SquatMatch): string {
  switch (m.pattern) {
    case 'scope-dropped':
      return `looks like ${m.target} without its scope`;
    case 'separator':
      return `differs from ${m.target} only in separators`;
    case 'affix':
      return `is ${m.target} with a js prefix or suffix added`;
    case 'doubled-letter':
      return `is ${m.target} with a letter doubled or dropped`;
    case 'homoglyph':
      return `looks like ${m.target} written with lookalike characters`;
    case 'swap':
      return `is ${m.target} with two letters swapped`;
    default:
      return `is one letter away from ${m.target}`;
  }
}
