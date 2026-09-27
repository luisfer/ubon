import { posix } from 'node:path';
import { splitLines } from '../../core/diff.ts';
import { languageOf } from '../../core/files.ts';
import { extractImports } from '../../core/project.ts';
import { parseSuppressions } from '../../core/suppress.ts';
import { ruleIds } from '../index.ts';
import type { DiffContext, Rule } from '../types.ts';
import { type TestCase, bodyContainment, extractTests, identifiersIn, titleContainment, tokenCount } from './test-cases.ts';
import {
  baseName,
  baseTextOf,
  changesOf,
  currentLineForBase,
  currentTextOf,
  dirName,
  isTestFile,
  joinPath,
  maskCode,
  maskFamily,
  movesOf,
  plural,
  prepareRun,
  runState,
  snippet,
  sourceKind,
} from './shared.ts';

/**
 * Tests removed in the change: a test file deleted while the module it tests
 * still exists, or test cases (matched by title) removed from a test file.
 *
 * Not reported: tests deleted together with the code they cover (the module
 * was deleted, or the functions the test calls were removed), tests that
 * moved to another file, renamed tests (same or nearly the same body under a
 * new title), and tests that were already skipped.
 */

const JS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs', 'vue', 'svelte', 'astro'];
const JS_TEST_SUFFIX = /\.(test|spec|e2e|e2e-spec|cy)\.[cm]?[jt]sx?$/;

/** Stem of the module a test file tests: foo.test.ts -> foo, test_foo.py -> foo, FooTest.java -> Foo. */
export function testStem(path: string): string | null {
  const base = baseName(path);
  switch (sourceKind(path)) {
    case 'js':
      if (JS_TEST_SUFFIX.test(base)) return base.replace(JS_TEST_SUFFIX, '');
      return base.replace(/\.[cm]?[jt]sx?$/, '');
    case 'python':
      return /^test_(.+)\.py$/.exec(base)?.[1] ?? /^(.+)_test\.py$/.exec(base)?.[1] ?? null;
    case 'go':
      return /^(.+)_test\.go$/.exec(base)?.[1] ?? null;
    case 'rust':
      return base.replace(/\.rs$/, '');
    case 'java':
    case 'kotlin':
    case 'csharp':
    case 'php':
    case 'swift':
      return /^(.+?)(Test|Tests|IT|Spec|TestCase)\.\w+$/.exec(base)?.[1] ?? /^Test(.+)\.\w+$/.exec(base)?.[1] ?? null;
    case 'ruby':
      return /^(.+)_(spec|test)\.rb$/.exec(base)?.[1] ?? null;
    case 'elixir':
      return /^(.+)_test\.exs$/.exec(base)?.[1] ?? null;
    default:
      return null;
  }
}

/** Paths where the module under test would live, most specific first. */
function moduleCandidates(path: string, stem: string): string[] {
  const dir = dirName(path);
  const out: string[] = [];
  const parentOfTestDir = /(^|\/)(__tests__|__test__|tests?|specs?)$/.test(dir) ? dirName(dir) : null;
  switch (sourceKind(path)) {
    case 'js':
      for (const d of [dir, parentOfTestDir].filter((d): d is string => d !== null)) {
        for (const ext of JS_EXTS) out.push(joinPath(d, `${stem}.${ext}`));
        if (stem !== 'index') for (const ext of JS_EXTS) out.push(joinPath(d, `${stem}/index.${ext}`));
      }
      break;
    case 'python':
      for (const d of [dir, parentOfTestDir].filter((d): d is string => d !== null)) out.push(joinPath(d, `${stem}.py`), joinPath(d, `${stem}/__init__.py`));
      break;
    case 'go':
      out.push(joinPath(dir, `${stem}.go`));
      break;
    case 'rust':
      if (/(^|\/)tests$/.test(dir)) out.push(joinPath(dirName(dir), `src/${stem}.rs`), joinPath(dirName(dir), `src/${stem}/mod.rs`));
      break;
    case 'java':
    case 'kotlin': {
      const ext = path.slice(path.lastIndexOf('.') + 1);
      const main = dir.replace(/(^|\/)src\/(test|androidTest|integrationTest|[a-zA-Z]+Test)\//, '$1src/main/');
      if (main !== dir) out.push(joinPath(main, `${stem}.${ext}`));
      out.push(joinPath(dir, `${stem}.${ext}`));
      break;
    }
    case 'ruby': {
      const rest = /^(?:.*\/)?(?:spec|test)\/(.*)$/.exec(dir)?.[1];
      const root = /^(.*\/)?(?:spec|test)(\/|$)/.exec(dir)?.[1] ?? '';
      if (rest !== undefined) for (const top of ['app', 'lib']) out.push(joinPath(root, `${top}/${rest}/${stem}.rb`), joinPath(root, `${top}/${stem}.rb`));
      else if (/(^|\/)(spec|test)$/.test(dir)) for (const top of ['app', 'lib']) out.push(joinPath(dirName(dir), `${top}/${stem}.rb`));
      break;
    }
    case 'elixir': {
      const m = /^(.*\/)?test(\/.*)?$/.exec(dir);
      if (m) out.push(joinPath(m[1] ?? '', `lib${m[2] ?? ''}/${stem}.ex`));
      break;
    }
    default:
      break;
  }
  return out;
}

/** The single non-test file named after the stem, for languages without a folder convention. */
function uniqueByStem(ctx: DiffContext, path: string, stem: string): string | null {
  const ext = path.slice(path.lastIndexOf('.'));
  const matches = ctx.project.files.filter((f) => f.endsWith(`/${stem}${ext}`) || f === `${stem}${ext}`).filter((f) => !isTestFile(f));
  return matches.length === 1 ? (matches[0] as string) : null;
}

const PY_IMPORT = /^\s*from\s+([.\w]+)\s+import\s+([\w\s,()*]+)|^\s*import\s+([\w.]+)/gm;

/** Modules a test file imports, resolved to repository paths that exist now. */
function importedModules(ctx: DiffContext, path: string, text: string): string[] {
  const out: string[] = [];
  const kind = sourceKind(path);
  if (kind === 'js') {
    for (const spec of extractImports(text)) {
      const hit = ctx.project.resolveImport(path, spec);
      if (hit && !isTestFile(hit)) out.push(hit);
    }
  } else if (kind === 'python') {
    const dir = dirName(path);
    for (const m of text.matchAll(PY_IMPORT)) {
      const mod = m[1] ?? m[3] ?? '';
      const names = (m[2] ?? '').split(/[\s,()]+/).filter(Boolean);
      const bases: string[] = [];
      if (mod.startsWith('.')) {
        const dots = /^\.+/.exec(mod)?.[0].length ?? 1;
        let d = dir;
        for (let k = 1; k < dots; k++) d = dirName(d);
        bases.push(joinPath(d, mod.slice(dots).split('.').filter(Boolean).join('/')));
      } else {
        const rel = mod.split('.').join('/');
        bases.push(rel, `src/${rel}`);
      }
      for (const b of bases) {
        for (const candidate of [`${b}.py`, `${b}/__init__.py`, ...names.map((n) => `${b}/${n}.py`)]) {
          const clean = candidate.replace(/^\/+/, '');
          if (ctx.project.has(clean) && !isTestFile(clean)) out.push(clean);
        }
      }
    }
  }
  return out;
}

function stemOfModule(path: string): string {
  const base = baseName(path).replace(/\.[^.]+$/, '');
  return base === 'index' || base === '__init__' || base === 'mod' ? baseName(dirName(path)) : base;
}

/** The module a test file tests, if it still exists. */
function findModule(ctx: DiffContext, path: string, text: string): string | null {
  const stem = testStem(path);
  if (!stem) return null;
  for (const candidate of moduleCandidates(path, stem)) if (ctx.project.has(candidate) && !isTestFile(candidate)) return candidate;
  for (const imported of importedModules(ctx, path, text)) if (stemOfModule(imported) === stem) return imported;
  const kind = sourceKind(path);
  if (kind === 'csharp' || kind === 'swift' || kind === 'php') return uniqueByStem(ctx, path, stem);
  return null;
}

/** Deleted scope files a test file referred to (the code was deleted together with its tests). */
function deletedModules(ctx: DiffContext, path: string, text: string): string[] {
  const deleted = new Set(ctx.scopeFiles.filter((f) => f.status === 'deleted').map((f) => f.path));
  if (deleted.size === 0) return [];
  const out: string[] = [];
  const stem = testStem(path);
  if (stem) for (const c of moduleCandidates(path, stem)) if (deleted.has(c)) out.push(c);
  if (sourceKind(path) === 'js') {
    for (const spec of extractImports(text)) {
      if (!spec.startsWith('.')) continue;
      const base = posix.normalize(posix.join(dirName(path) || '.', spec)).replace(/\.(js|jsx|mjs|cjs)$/, '');
      for (const candidate of [base, ...JS_EXTS.map((e) => `${base}.${e}`), ...JS_EXTS.map((e) => `${base}/index.${e}`)]) if (deleted.has(candidate)) out.push(candidate);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Removed code

const DECLARATION =
  /\b(?:function\*?|class|interface|type|enum|const|let|var|def|func|fn|struct|trait|module|fun|record)\s+([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:(?:public|private|protected|static|async|readonly|override|abstract|final|synchronized)\s+)*(?:[\w<>[\],.?]+\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=;]+)?\{/gm;
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor', 'else', 'do', 'try', 'new', 'await', 'typeof']);

function declaredNames(text: string, path: string): Set<string> {
  const out = new Set<string>();
  const code = maskCode(text, maskFamily(path));
  for (const m of code.matchAll(DECLARATION)) {
    const name = m[1] ?? m[2];
    if (name && name.length >= 3 && !NOT_A_NAME.has(name)) out.add(name);
  }
  if (sourceKind(path) === 'js') for (const c of constructorsWithParameters(code)) out.add(`new:${c}`);
  return out;
}

/**
 * Classes whose constructor takes parameters, as `new:<Class>` names. When
 * such a constructor is removed, tests that call `new Class(args)` tested
 * code that is gone.
 */
function constructorsWithParameters(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{;]*\{/g)) {
    let depth = 1;
    let k = (m.index ?? 0) + m[0].length;
    const start = k;
    while (k < code.length && depth > 0) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}') depth--;
      k++;
    }
    if (/\bconstructor\s*\(\s*[^)\s]/.test(code.slice(start, k))) out.push(m[1] as string);
  }
  return out;
}

const declaredNow = new WeakMap<object, Set<string>>();

/** Names declared in the current version of every changed non-test file. */
function namesDeclaredNow(ctx: DiffContext): Set<string> {
  const cached = declaredNow.get(ctx.project);
  if (cached) return cached;
  const out = new Set<string>();
  for (const f of ctx.scopeFiles) {
    if (f.status === 'deleted' || f.status === 'unchanged' || isTestFile(f.path) || sourceKind(f.path) === 'other') continue;
    const text = currentTextOf(ctx.project, f.path);
    if (text) for (const n of declaredNames(text, f.path)) out.add(n);
  }
  declaredNow.set(ctx.project, out);
  return out;
}

/** Names a module declared at the base that no changed file declares now. */
function removedNames(ctx: DiffContext, module: string): Set<string> {
  const base = baseTextOf(ctx.project, module);
  if (!base) return new Set();
  const now = namesDeclaredNow(ctx);
  const current = currentTextOf(ctx.project, module);
  const stillHere = current ? declaredNames(current, module) : new Set<string>();
  return new Set([...declaredNames(base, module)].filter((n) => !stillHere.has(n) && !now.has(n)));
}

/** Modules whose removed code can explain removed tests. */
function relatedModules(ctx: DiffContext, path: string, texts: string[]): string[] {
  const changed = new Set(ctx.scopeFiles.filter((f) => f.status !== 'unchanged' && f.status !== 'added').map((f) => f.path));
  const out = new Set<string>();
  for (const text of texts) {
    const module = findModule(ctx, path, text);
    if (module && changed.has(module)) out.add(module);
    for (const m of importedModules(ctx, path, text)) if (changed.has(m)) out.add(m);
    if (sourceKind(path) === 'go') for (const f of changed) if (dirName(f) === dirName(path) && f.endsWith('.go') && !f.endsWith('_test.go')) out.add(f);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Tests elsewhere

/** Current text of the other changed test files, to find tests that moved there. */
function otherTestTexts(ctx: DiffContext, path: string): string[] {
  const out: string[] = [];
  for (const f of ctx.scopeFiles) {
    if (f.path === path || f.status === 'deleted' || f.status === 'unchanged' || !isTestFile(f.path)) continue;
    const text = currentTextOf(ctx.project, f.path);
    if (text) out.push(text);
  }
  return out;
}

/** The test appears in another test file: as a quoted title (JS, Ruby, Elixir) or as a declared name. */
function mentions(texts: string[], test: TestCase, path: string): boolean {
  const name = test.name;
  if (name.length < 3) return false;
  const kind = sourceKind(path);
  if (kind === 'js' || kind === 'ruby' || kind === 'elixir') {
    const quoted = [`'${name}'`, `"${name}"`, `\`${name}\``];
    return texts.some((t) => quoted.some((q) => t.includes(q)));
  }
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return texts.some((t) => re.test(t));
}

function suppressedIn(ctx: DiffContext, module: string): boolean {
  const text = currentTextOf(ctx.project, module);
  if (!text || !text.includes('ubon-ignore')) return false;
  return parseSuppressions(text, splitLines(text), languageOf(module), module, ruleIds()).some((s) => s.valid && s.rules.includes('integrity/test-deleted'));
}

function deletedFile(ctx: DiffContext): void {
  const path = ctx.file.path;
  const before = ctx.before;
  if (before === null || movesOf(ctx.project).to.has(path)) return;
  const parsed = extractTests(before, path, ctx.file.lang);
  if (!parsed) return;
  const live = parsed.tests.filter((t) => !t.skipped);
  if (live.length === 0) return;
  const module = findModule(ctx, path, before);
  if (!module) return;
  const elsewhere = otherTestTexts(ctx, path);
  const removed = removedNames(ctx, module);
  for (const d of deletedModules(ctx, path, before)) for (const n of removedNames(ctx, d)) removed.add(n);
  const missing = live.filter((t) => !mentions(elsewhere, t, path) && !touchesRemovedCode(t, removed));
  if (missing.length === 0 || suppressedIn(ctx, module)) return;
  ctx.report({
    line: 1,
    message: `${baseName(path)} was deleted, but the module it tests (${module}) still exists; ${plural(missing.length, 'test')} no longer run.`,
    fix: `Restore ${baseName(path)}, or delete the tests together with the code they cover; if the deletion is intended, add \`// ubon-ignore integrity/test-deleted: <who decided>: <reason>\` to ${module}.`,
    evidence: path,
  });
}

function touchesRemovedCode(test: TestCase, removed: ReadonlySet<string>): boolean {
  if (removed.size === 0) return false;
  for (const id of identifiersIn(test.expanded)) if (removed.has(id)) return true;
  // new Node('get', handler) when Node's constructor with parameters was removed.
  for (const m of test.expanded.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\(\s*[^)\s]/g)) if (removed.has(`new:${m[1]}`)) return true;
  return false;
}

function removedCases(ctx: DiffContext): void {
  const after = ctx.after;
  if (after === null) return;
  const changes = changesOf(ctx);
  if (changes.before === null || changes.removed.length === 0) return;
  const beforeFile = extractTests(changes.before, ctx.file.path, ctx.file.lang);
  if (!beforeFile || beforeFile.tests.length === 0) return;
  const afterFile = extractTests(after, ctx.file.path, ctx.file.lang);
  if (!afterFile) return;
  const beforeTests = beforeFile.tests;
  const afterTests = afterFile.tests;

  const remaining = new Map<string, number>();
  for (const t of afterTests) remaining.set(t.title, (remaining.get(t.title) ?? 0) + 1);
  const gone: TestCase[] = [];
  for (const t of beforeTests) {
    const n = remaining.get(t.title) ?? 0;
    if (n > 0) remaining.set(t.title, n - 1);
    else gone.push(t);
  }
  if (gone.length === 0) return;
  const baseTitles = new Set(beforeTests.map((t) => t.title));
  const pool = afterTests.filter((t) => !baseTitles.has(t.title));

  // Tests removed together with the code they cover: the module under test was
  // deleted, or the names a test uses were removed from the modules it imports.
  const stem = testStem(ctx.file.path);
  const deleted = deletedModules(ctx, ctx.file.path, changes.before);
  if (stem && deleted.some((d) => stemOfModule(d) === stem)) return;
  const removed = new Set<string>();
  for (const m of [...relatedModules(ctx, ctx.file.path, [changes.before, after]), ...deleted]) for (const n of removedNames(ctx, m)) removed.add(n);
  const elsewhere = otherTestTexts(ctx, ctx.file.path);
  const afterLines = splitLines(after).length;

  const candidates = gone.filter((t) => !t.skipped && !touchesRemovedCode(t, removed) && !mentions(elsewhere, t, ctx.file.path));
  const unmatched = new Set(candidates);
  const free = new Set(pool);
  // Renames: the same body under a new title.
  for (const t of candidates) {
    const same = [...free].find((c) => c.body === t.body && t.body.length > 0);
    if (same) {
      free.delete(same);
      unmatched.delete(t);
    }
  }
  // Rewrites: a new test that keeps most of the old body (an extended test, an
  // it.each table), most of the old title with a good part of the body, or a
  // one-for-one replacement in the same describe block that keeps half the body.
  const pairs: Array<{ t: TestCase; c: TestCase; score: number }> = [];
  for (const t of unmatched) {
    const size = tokenCount(t.body);
    for (const c of free) {
      const kept = bodyContainment(t.body, c.expanded);
      const title = titleContainment(t.name, c.name);
      const sameGroup = t.group === c.group;
      if ((kept >= 0.8 && size >= 8) || (title >= 0.6 && kept >= 0.5) || (sameGroup && (title >= 0.8 || kept >= 0.5))) {
        pairs.push({ t, c, score: kept + title + (sameGroup ? 0.5 : 0) });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (!unmatched.has(p.t) || !free.has(p.c)) continue;
    unmatched.delete(p.t);
    free.delete(p.c);
  }

  const lost = candidates.filter((t) => unmatched.has(t));
  const first = lost[0];
  if (!first) return;
  // Anchor on the enclosing describe block when it still exists; otherwise where the test was.
  const groupLine = first.group ? afterFile.groups.get(first.group) : undefined;
  const line = groupLine ?? currentLineForBase(first.line, changes, afterLines);
  if (lost.length === 1) {
    ctx.report({
      line,
      message: `The test "${snippet(first.title, 80)}" was removed from this file.`,
      fix: 'Restore the test, or remove it together with the code it covers; if the test was wrong, tell the user instead of deleting it.',
      key: first.title,
      evidence: snippet(first.title, 120),
    });
    return;
  }
  const fix = 'Restore the tests, or remove them together with the code they cover; if a test was wrong, tell the user instead of deleting it.';
  // One finding per file: a rewritten suite should not produce a wall of findings.
  const names = lost.slice(0, 3).map((t) => `"${snippet(t.title, 50)}"`).join(', ');
  ctx.report({
    line,
    message: `${lost.length} tests were removed from this file: ${names}${lost.length > 3 ? `, and ${lost.length - 3} more` : ''}.`,
    fix,
    key: lost.map((t) => t.title).join('\n'),
    evidence: snippet(lost.map((t) => t.title).join('; '), 180),
  });
}

export const testDeleted: Rule = {
  meta: {
    id: 'integrity/test-deleted',
    level: 'block',
    scope: 'diff',
    title: 'Test deleted while its code remains',
    summary: 'A test file deleted while the module it tests still exists, or test cases (matched by title) removed from a test file.',
    why: 'Deleting a failing test makes a run pass without fixing anything, and coding agents do this under pressure to finish (ImpossibleBench, 2025). Tests removed together with the code they cover, moved to another file, or renamed are not reported.',
    fix: 'Restore the test, or remove it together with the code it covers; if the test was wrong, tell the user instead of deleting it.',
    references: ['https://arxiv.org/abs/2510.20270'],
  },
  appliesTo: (file) => !file.generated && isTestFile(file.path),
  project: prepareRun,
  diff(ctx) {
    if (!runState(ctx.project)) return;
    if (ctx.status === 'deleted') deletedFile(ctx);
    else removedCases(ctx);
  },
};
