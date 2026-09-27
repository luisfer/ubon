import { posix } from 'node:path';
import { diffLines, splitLines } from '../../core/diff.ts';
import type { Lang } from '../../core/files.ts';
import type { Project } from '../../core/project.ts';
import { type CommentStyle, commentStyleFor } from '../../lang/comments.ts';
import type { DiffContext, LineChange, ProjectContext, ScopeFileView } from '../types.ts';

/**
 * Helpers shared by the integrity and hygiene diff rules: languages the core
 * does not model (Python, Go, Rust, ...), test file detection, comment and
 * string masking for text matching, file moves (a deleted file and an added
 * file with the same content), and "new occurrence" counting so that code
 * which only moved or was re-indented is not reported as new.
 */

// ---------------------------------------------------------------------------
// Languages

export type SourceKind = 'js' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'ruby' | 'csharp' | 'php' | 'elixir' | 'swift' | 'other';

export function sourceKind(path: string): SourceKind {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'js';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'kt':
    case 'kts':
      return 'kotlin';
    case 'rb':
      return 'ruby';
    case 'cs':
      return 'csharp';
    case 'php':
      return 'php';
    case 'ex':
    case 'exs':
      return 'elixir';
    case 'swift':
      return 'swift';
    default:
      return 'other';
  }
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  return dir ? posix.normalize(`${dir}/${name}`) : posix.normalize(name);
}

/** Comment style for any source file, including languages the core treats as plain text. */
export function commentStyleForPath(lang: Lang, path: string): CommentStyle {
  const style = commentStyleFor(lang, path);
  if (style !== 'none') return style;
  if (/\.(go|rs|java|kt|kts|scala|c|h|cc|cpp|cxx|hpp|hh|cs|swift|php|dart|groovy|gradle|m|mm|css|scss|less|proto|zig)$/i.test(path)) return 'c';
  if (/\.(html?|xhtml|xml|svg)$/i.test(path)) return 'html';
  if (/\.(ex|exs|r|pl|pm|cr|nim|coffee|tcl)$/i.test(path)) return 'hash';
  return 'none';
}

// ---------------------------------------------------------------------------
// Test files

/** Test data rather than tests: fixtures, snapshots, mocks. */
const DATA_DIR = /(^|\/)(__fixtures__|fixtures?|testdata|test-data|test_data|__mocks__|mocks|__snapshots__|snapshots)\//;
const JS_NOT_A_TEST = /\.(stories|story|bench)\.[cm]?[jt]sx?$|(^|\/)(jest|vitest|playwright|cypress|karma|ava|wdio)\.config\.[cm]?[jt]s$|(^|\/)vitest\.(workspace|projects)\.[cm]?[jt]s$|(^|\/)(setupTests|test-setup|setup-tests)\.[cm]?[jt]sx?$/;
const JS_TEST_NAME = /\.(test|spec|e2e|e2e-spec|cy)\.[cm]?[jt]sx?$/;
const JS_TEST_DIR = /(^|\/)(__tests__|__test__|test|tests|spec|specs|e2e|cypress|playwright)\//;

export function isFixtureData(path: string): boolean {
  return DATA_DIR.test(path);
}

/**
 * A file that declares test cases, by the naming conventions of each
 * language. Fixture folders, snapshots, stories, and test runner config are
 * not test files.
 */
export function isTestFile(path: string): boolean {
  if (DATA_DIR.test(path)) return false;
  const base = baseName(path);
  switch (sourceKind(path)) {
    case 'js':
      if (JS_NOT_A_TEST.test(path)) return false;
      return JS_TEST_NAME.test(base) || JS_TEST_DIR.test(path);
    case 'python':
      return /^test_.*\.py$|_test\.py$|^tests?\.py$/.test(base) || /(^|\/)tests?\//.test(path);
    case 'go':
      return base.endsWith('_test.go');
    case 'rust':
      // #[ignore] and #[test] only have meaning on tests; unit tests live next to the code.
      return true;
    case 'java':
    case 'kotlin':
      return /(^|\/)src\/(test|androidTest|integrationTest|testFixtures|[a-zA-Z]+Test)\//.test(path) || /(Test|Tests|IT|Spec|TestCase)\.(java|kt|kts)$/.test(base);
    case 'ruby':
      return /_spec\.rb$|_test\.rb$/.test(base) || /(^|\/)(spec|test)\//.test(path);
    case 'csharp':
      return /Tests?\.cs$/.test(base) || /(^|\/)[^/]*\.Tests?\//.test(path);
    case 'php':
      return /Test\.php$/.test(base);
    case 'elixir':
      return /_test\.exs$/.test(base);
    case 'swift':
      return /Tests?\.swift$/.test(base) || /(^|\/)Tests\//.test(path);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Masking for text matching

export type MaskFamily = 'c' | 'python' | 'hash';

export function maskFamily(path: string): MaskFamily {
  const kind = sourceKind(path);
  if (kind === 'python') return 'python';
  if (kind === 'ruby' || kind === 'elixir') return 'hash';
  return 'c';
}

/**
 * Replace comments and the contents of string literals with spaces, keeping
 * quotes, newlines, and offsets. Text matching then only sees code. The
 * scanner is deliberately simple: it knows line and block comments, quotes,
 * backticks, and Python triple quotes.
 */
export function maskCode(text: string, family: MaskFamily): string {
  const out = text.split('');
  const n = text.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const ch = text[i] as string;
    const next = text[i + 1];
    const lineComment = family === 'c' ? ch === '/' && next === '/' : ch === '#';
    if (lineComment) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (family === 'c' && ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (family === 'python' && (ch === '"' || ch === "'") && text.startsWith(ch.repeat(3), i)) {
      const quote = ch.repeat(3);
      const end = text.indexOf(quote, i + 3);
      const stop = end === -1 ? n : end + 3;
      blank(i + 3, stop - 3);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || (family === 'c' && ch === '`')) {
      let j = i + 1;
      while (j < n) {
        const c = text[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === ch) break;
        if (c === '\n' && ch !== '`') break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Per-run state: file moves and the base content of other files

interface Moves {
  /** Added path to the deleted path it came from. */
  from: Map<string, string>;
  /** Deleted path to the added path it went to. */
  to: Map<string, string>;
}

interface RunState {
  scope: readonly ScopeFileView[];
  base(path: string): string | null;
  read(path: string): string | null;
  moves?: Moves;
  changes: Map<string, Changes>;
}

const states = new WeakMap<Project, RunState>();

/**
 * Diff rules only see their own file. Rules that need other files (a deleted
 * file's content for move detection, a module next to a deleted test) call
 * this from their `project` hook, which the engine runs before diff rules.
 */
export function prepareRun(ctx: ProjectContext): void {
  if (states.has(ctx.project)) return;
  states.set(ctx.project, { scope: ctx.scopeFiles, base: (p) => ctx.base(p), read: (p) => ctx.read(p), changes: new Map() });
}

export function runState(project: Project): RunState | undefined {
  return states.get(project);
}

/** Base content of any changed file in this run (null when unknown). */
export function baseTextOf(project: Project, path: string): string | null {
  return states.get(project)?.base(path) ?? null;
}

/** Current content of a file, from the engine's cache when it has one. */
export function currentTextOf(project: Project, path: string): string | null {
  const state = states.get(project);
  return state ? state.read(path) : project.read(path);
}

type Bag = Map<string, number>;

function lineBag(text: string): Bag {
  const bag: Bag = new Map();
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line.replace(/\s+/g, '').length < 4) continue;
    bag.set(line, (bag.get(line) ?? 0) + 1);
  }
  return bag;
}

export function bagSimilarity(a: Bag, b: Bag): number {
  let total = 0;
  let shared = 0;
  for (const n of a.values()) total += n;
  for (const [line, n] of b) {
    total += n;
    shared += Math.min(n, a.get(line) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

export function textSimilarity(a: string, b: string): number {
  return bagSimilarity(lineBag(a), lineBag(b));
}

const MAX_MOVE_TEXT = 512 * 1024;

/**
 * Files that were moved without git noticing: an agent that runs `mv`, or a
 * rename that git sees as a deletion plus an untracked file. A deleted file
 * and an added file are paired when their lines are similar enough (at least
 * half the lines for the same file name, 70 percent otherwise).
 */
export function movesOf(project: Project): Moves {
  const state = states.get(project);
  if (!state) return { from: new Map(), to: new Map() };
  if (state.moves) return state.moves;
  const moves: Moves = { from: new Map(), to: new Map() };
  state.moves = moves;
  const added = state.scope.filter((f) => f.status === 'added').map((f) => f.path);
  const deleted = state.scope.filter((f) => f.status === 'deleted').map((f) => f.path);
  if (added.length === 0 || deleted.length === 0) return moves;
  const onlySameName = added.length * deleted.length > 20_000;
  const bags = new Map<string, Bag | null>();
  const bagFor = (path: string, text: () => string | null): Bag | null => {
    if (bags.has(path)) return bags.get(path) ?? null;
    const t = text();
    const bag = t !== null && t.length <= MAX_MOVE_TEXT ? lineBag(t) : null;
    bags.set(path, bag);
    return bag;
  };
  const pairs: Array<{ a: string; d: string; score: number }> = [];
  for (const d of deleted) {
    for (const a of added) {
      const sameName = baseName(a) === baseName(d);
      if (onlySameName && !sameName) continue;
      if (sourceKind(a) !== sourceKind(d) || (sourceKind(a) === 'other' && extensionOf(a) !== extensionOf(d))) continue;
      const bd = bagFor(d, () => state.base(d));
      if (!bd || bd.size === 0) continue;
      const ba = bagFor(a, () => state.read(a));
      if (!ba || ba.size === 0) continue;
      const score = bagSimilarity(bd, ba);
      if (score >= (sameName ? 0.5 : 0.7)) pairs.push({ a, d, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.d < y.d ? -1 : 1));
  for (const p of pairs) {
    if (moves.from.has(p.a) || moves.to.has(p.d)) continue;
    moves.from.set(p.a, p.d);
    moves.to.set(p.d, p.a);
  }
  return moves;
}

function extensionOf(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

export interface Changes {
  /** Content the current file is compared with: the base, or the file it was moved from. */
  before: string | null;
  added: readonly LineChange[];
  removed: readonly LineChange[];
  addedLines: ReadonlySet<number>;
  /** Path the content came from when the file was renamed or moved. */
  from?: string;
}

/**
 * The changes of a diff context, treating a moved file as a modification of
 * the file it came from. Without this, every line of a moved file would look
 * new, and a skip or suppression that already existed would be reported.
 */
export function changesOf(ctx: DiffContext): Changes {
  const state = states.get(ctx.project);
  const cached = state?.changes.get(ctx.file.path);
  if (cached) return cached;
  let result: Changes | null = null;
  if (ctx.status === 'added' && state) {
    const from = movesOf(ctx.project).from.get(ctx.file.path);
    const before = from !== undefined ? state.base(from) : null;
    if (from !== undefined && before !== null) {
      const d = diffLines(before, ctx.after);
      result = { before, added: d.added, removed: d.removed, addedLines: new Set(d.added.map((l) => l.line)), from };
    }
  }
  if (!result) {
    result = {
      before: ctx.before,
      added: ctx.added,
      removed: ctx.removed,
      addedLines: new Set(ctx.added.map((l) => l.line)),
      ...(ctx.status === 'renamed' && ctx.oldPath ? { from: ctx.oldPath } : {}),
    };
  }
  state?.changes.set(ctx.file.path, result);
  return result;
}

// ---------------------------------------------------------------------------
// New occurrences

export interface Occurrence {
  line: number;
  /** What makes two occurrences the same thing (kind plus normalized text or title). */
  sig: string;
}

/**
 * Occurrences in the current file that are new: on an added line, and more
 * of them than at the base for the same signature. A skip that moved, or a
 * line that was only re-indented, is not new.
 */
export function newOccurrences<T extends Occurrence>(after: readonly T[], before: readonly Occurrence[], addedLines: ReadonlySet<number>): T[] {
  const budget = new Map<string, number>();
  for (const o of after) budget.set(o.sig, (budget.get(o.sig) ?? 0) + 1);
  for (const o of before) if (budget.has(o.sig)) budget.set(o.sig, (budget.get(o.sig) ?? 0) - 1);
  const out: T[] = [];
  for (const o of after) {
    if (!addedLines.has(o.line)) continue;
    const left = budget.get(o.sig) ?? 0;
    if (left <= 0) continue;
    budget.set(o.sig, left - 1);
    out.push(o);
  }
  return out;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The line in the current file where a base line ended up: the first line
 * after the removal point that both versions share. Used to place findings
 * about removed code.
 */
export function currentLineForBase(baseLine: number, changes: Pick<Changes, 'added' | 'removed'>, currentLineCount: number): number {
  let removedBefore = 0;
  for (const r of changes.removed) if (r.line < baseLine) removedBefore++;
  const unchangedBefore = baseLine - 1 - removedBefore;
  const added = new Set(changes.added.map((l) => l.line));
  let seen = 0;
  for (let line = 1; line <= currentLineCount; line++) {
    if (added.has(line)) continue;
    if (seen === unchangedBefore) return line;
    seen++;
  }
  return Math.max(1, currentLineCount);
}

// ---------------------------------------------------------------------------
// Small text helpers

export function lineCount(text: string | null): number {
  return text === null ? 0 : splitLines(text).length;
}

/** Plural helper for messages. */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Shorten a code snippet for a message. */
export function snippet(text: string, max = 60): string {
  const one = normalizeWhitespace(text);
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
}
