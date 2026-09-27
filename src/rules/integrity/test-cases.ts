import type { CallExpression, Node } from '@babel/types';
import { splitLines } from '../../core/diff.ts';
import type { Lang } from '../../core/files.ts';
import { maskComments } from '../../lang/comments.ts';
import { propertyName, stringValue, unwrap } from '../../lang/js.ts';
import { parseSource } from '../../lang/parse.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import { commentStyleForPath, maskCode, maskFamily, normalizeWhitespace, sourceKind } from './shared.ts';

/**
 * Test cases declared in a test file: their titles (with the enclosing
 * describe blocks), where they start, a normalized copy of their body, and
 * whether they were skipped. Used to find tests removed in a change and to
 * tell a removal from a rename.
 */

export interface TestCase {
  /** Enclosing group titles and the test title, joined with " > ". */
  title: string;
  /** The test's own title or function name. */
  name: string;
  line: number;
  /** Body without comments, whitespace collapsed, for rename matching. */
  body: string;
  /** The body plus the bodies of helper functions in the same file that it calls (one level). */
  expanded: string;
  /** Skipped, focused away, or a todo at declaration. */
  skipped: boolean;
  /** Title path of the enclosing groups ('' at the top level). */
  group: string;
}

export interface TestFile {
  tests: TestCase[];
  /** Line of each group (describe block) by its title path. */
  groups: Map<string, number>;
}

const JS_TEST_ROOTS = new Set(['it', 'test', 'specify', 'xit', 'xtest', 'xspecify', 'fit', 'Deno.test']);
const JS_GROUP_ROOTS = new Set(['describe', 'context', 'suite', 'xdescribe', 'fdescribe', 'xcontext', 'xsuite', 'fcontext']);
const JS_ALLOWED = new Set(['skip', 'only', 'todo', 'fixme', 'each', 'for', 'concurrent', 'sequential', 'serial', 'parallel', 'failing', 'fails', 'fail', 'skipIf', 'runIf', 'if', 'ignore', 'describe']);
const JS_SKIPPED = new Set(['skip', 'todo', 'fixme', 'ignore']);

interface JsDecl {
  kind: 'test' | 'group';
  title: string;
  skipped: boolean;
  fn: Node | null;
}

function jsChain(callee: Node): { root: string; props: string[] } | null {
  const props: string[] = [];
  let n: Node | null = callee;
  while (n) {
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      const name = propertyName(n);
      if (name === null) return null;
      props.unshift(name);
      n = n.object as Node;
    } else if (n.type === 'CallExpression') {
      n = n.callee as Node;
    } else if (n.type === 'Identifier') {
      if (n.name === 'Deno' && props[0] === 'test') return { root: 'Deno.test', props: props.slice(1) };
      return { root: n.name, props };
    } else {
      return null;
    }
  }
  return null;
}

function jsTitle(node: Node | undefined, text: string): string | null {
  if (!node) return null;
  const value = stringValue(node);
  if (value !== null) return value;
  const n = unwrap(node);
  if (!n || isFunctionNode(n) || n.start == null || n.end == null) return null;
  if (n.type === 'TemplateLiteral') return n.quasis.map((q) => q.value.raw).join('${}');
  return normalizeWhitespace(text.slice(n.start, n.end)).slice(0, 120);
}

function jsDecl(call: CallExpression, text: string): JsDecl | null {
  const chain = jsChain(call.callee as Node);
  if (!chain) return null;
  if (!chain.props.every((p) => JS_ALLOWED.has(p))) return null;
  const args = call.arguments as Node[];
  let fn = args.find((a) => isFunctionNode(unwrap(a) ?? a)) ?? null;
  const options = unwrap(args[0]);
  if (!fn && options?.type === 'ObjectExpression') {
    // Deno.test({ name, fn }) and similar option objects.
    for (const prop of options.properties) {
      if (prop.type === 'ObjectMethod' && prop.key.type === 'Identifier' && prop.key.name === 'fn') fn = prop;
      else if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier' && prop.key.name === 'fn' && isFunctionNode(prop.value as Node)) fn = prop.value as Node;
    }
  }
  const isGroup = JS_GROUP_ROOTS.has(chain.root) || (chain.root === 'test' && chain.props.includes('describe'));
  const isTest = !isGroup && (JS_TEST_ROOTS.has(chain.root) || chain.props.includes('describe'));
  if (!isGroup && !isTest) return null;
  if (chain.props.includes('describe') && !isGroup) return null;
  const todo = chain.props.includes('todo');
  if (!fn && !todo) return null;
  // Deno.test({ name, fn }) and friends: the title is a property.
  let titleNode = args[0];
  const first = unwrap(args[0]);
  if (first?.type === 'ObjectExpression') {
    for (const prop of first.properties) if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier' && prop.key.name === 'name') titleNode = prop.value as Node;
  }
  const title = jsTitle(titleNode, text);
  if (title === null) return null;
  const optionSkip = args.some((a) => {
    const o = unwrap(a);
    return (
      o?.type === 'ObjectExpression' &&
      o.properties.some((p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && ['skip', 'todo', 'ignore'].includes(p.key.name) && !(p.value.type === 'BooleanLiteral' && !p.value.value))
    );
  });
  const skipped = /^x/.test(chain.root) || chain.props.some((p) => JS_SKIPPED.has(p)) || optionSkip;
  return { kind: isGroup ? 'group' : 'test', title, skipped, fn: fn ? (unwrap(fn) ?? fn) : null };
}

/** Named functions declared anywhere in a file (`function f`, `const f = () => ...`), by name. */
function localFunctions(program: Node, code: string): Map<string, string> {
  const out = new Map<string, string>();
  walk(program, {
    enter(node) {
      let name: string | null = null;
      let fn: Node | null = null;
      if (node.type === 'FunctionDeclaration' && node.id) {
        name = node.id.name;
        fn = node;
      } else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && isFunctionNode(node.init as Node)) {
        name = node.id.name;
        fn = node.init as Node;
      }
      if (name && fn && fn.start != null && fn.end != null && fn.end - fn.start < 20_000 && !out.has(name)) out.set(name, code.slice(fn.start, fn.end));
    },
  });
  return out;
}

/** A test body plus the bodies of the file's own helper functions it calls, so a test moved into a helper still matches. */
function expandHelpers(body: string, helpers: ReadonlyMap<string, string>): string {
  if (helpers.size === 0) return body;
  const parts = [body];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1] as string;
    const helper = helpers.get(name);
    if (!helper || seen.has(name)) continue;
    seen.add(name);
    parts.push(helper);
  }
  return parts.join(' ');
}

function extractJs(text: string, lang: Lang): TestFile | null {
  const parsed = parseSource(text, lang);
  if (parsed.blocks.length === 0 || parsed.failed) return null;
  const out: TestCase[] = [];
  const groupLines = new Map<string, number>();
  // Same offsets as the text, with comments blanked: a comment edited or dropped is not a change to the test.
  const code = maskComments(text, 'c');
  for (const block of parsed.blocks) {
    if (block.errors > 0) return null;
    const groups = new Map<Node, JsDecl>();
    const helpers = localFunctions(block.program.program, code);
    walk(block.program.program, {
      enter(node, parents) {
        if (node.type !== 'CallExpression') return;
        const decl = jsDecl(node as CallExpression, text);
        if (!decl) return;
        const path: string[] = [];
        let groupSkipped = false;
        for (const p of parents) {
          const g = groups.get(p);
          if (g) {
            path.push(g.title);
            groupSkipped ||= g.skipped;
          }
        }
        if (decl.kind === 'group') {
          if (decl.fn) groups.set(decl.fn, decl);
          const key = [...path, decl.title].join(' > ');
          if (!groupLines.has(key)) groupLines.set(key, node.loc?.start.line ?? 1);
          return;
        }
        let body = decl.fn && decl.fn.start != null && decl.fn.end != null ? code.slice(decl.fn.start, decl.fn.end) : '';
        // it.each(table)('title', fn): the table holds the cases, so it is part of the body.
        const callee = (node as CallExpression).callee as Node;
        if (callee.type === 'CallExpression') {
          for (const arg of callee.arguments as Node[]) if (arg.start != null && arg.end != null) body = `${code.slice(arg.start, arg.end)} ${body}`;
        }
        const normalized = normalizeWhitespace(body);
        out.push({
          title: [...path, decl.title].join(' > '),
          name: decl.title,
          line: node.loc?.start.line ?? 1,
          body: normalized,
          expanded: normalizeWhitespace(expandHelpers(body, helpers)),
          skipped: decl.skipped || groupSkipped,
          group: path.join(' > '),
        });
      },
    });
  }
  return { tests: out, groups: groupLines };
}

// ---------------------------------------------------------------------------
// Other languages

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Body of an indentation block starting after a header line. */
function indentBody(lines: string[], index: number, endKeyword: boolean): { text: string; end: number } {
  const indent = indentOf(lines[index] ?? '');
  const body: string[] = [];
  let j = index + 1;
  for (; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (indentOf(line) <= indent) {
      if (endKeyword && /^\s*end\b/.test(line)) j++;
      break;
    }
    body.push(line);
  }
  return { text: body.join('\n'), end: j };
}

/** Body between the first `{` at or after an offset and its matching `}` (in masked text). */
function braceBody(masked: string, raw: string, offset: number): string {
  const open = masked.indexOf('{', offset);
  if (open === -1 || open - offset > 2000) return '';
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    const ch = masked[k];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(open, k + 1);
    }
  }
  return raw.slice(open);
}

/** The text with comments blanked out (strings kept: their contents help match rewritten tests). */
function withoutComments(text: string, path: string): string {
  const style = commentStyleForPath('text', path);
  return style === 'none' ? text : maskComments(text, style);
}

function extractPython(text: string, path: string): TestFile {
  const raw = splitLines(withoutComments(text, path));
  const code = splitLines(maskCode(text, maskFamily(path)));
  const out: TestCase[] = [];
  const groups = new Map<string, number>();
  code.forEach((line, i) => {
    const m = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(line);
    if (!m) return;
    const name = m[2] as string;
    const indent = (m[1] ?? '').length;
    let cls: string | null = null;
    for (let j = i - 1; j >= 0 && indent > 0; j--) {
      const c = code[j] ?? '';
      if (c.trim() === '') continue;
      if (indentOf(c) < indent) {
        cls = /^\s*class\s+(\w+)/.exec(c)?.[1] ?? null;
        if (cls && !groups.has(cls)) groups.set(cls, j + 1);
        break;
      }
    }
    let skipped = false;
    for (let j = i - 1; j >= 0; j--) {
      const c = (code[j] ?? '').trim();
      if (!c.startsWith('@')) break;
      if (/skip|xfail/.test(c)) skipped = true;
    }
    const body = normalizeWhitespace(indentBody(raw, i, false).text);
    out.push({ title: cls ? `${cls} > ${name}` : name, name, line: i + 1, body, expanded: body, skipped, group: cls ?? '' });
  });
  return { tests: out, groups };
}

function extractBrace(text: string, path: string): TestCase[] {
  const kind = sourceKind(path);
  const raw = splitLines(text);
  const masked = maskCode(text, maskFamily(path));
  const code = splitLines(masked);
  const starts = [0];
  for (let i = 0; i < masked.length; i++) if (masked.charCodeAt(i) === 10) starts.push(i + 1);
  const out: TestCase[] = [];
  const commentless = withoutComments(text, path);
  const push = (i: number, name: string, skipped: boolean) => {
    const body = normalizeWhitespace(braceBody(masked, commentless, starts[i] ?? 0));
    out.push({ title: name, name, line: i + 1, body, expanded: body, skipped, group: '' });
  };
  /** Annotations or attributes in the lines above a declaration. */
  const annotationsAbove = (i: number): string => {
    const found: string[] = [];
    for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
      const c = (code[j] ?? '').trim();
      if (c === '') continue;
      if (/^(@|#\[|\[)/.test(c)) found.push(c);
      else break;
    }
    return found.join(' ');
  };
  code.forEach((line, i) => {
    let m: RegExpExecArray | null;
    switch (kind) {
      case 'go':
        m = /^func\s+(Test\w*|Example\w*|Fuzz\w*)\s*\(/.exec(line);
        if (m) push(i, m[1] as string, false);
        return;
      case 'rust':
        m = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/.exec(line);
        if (m && /#\[\s*(?:[\w:]+::)?(test|rstest|test_case)\b/.test(annotationsAbove(i))) push(i, m[1] as string, /#\[\s*ignore\b/.test(annotationsAbove(i)));
        return;
      case 'java':
      case 'kotlin': {
        m = /\bfun\s+(?:`([^`]+)`|(\w+))\s*\(|\bvoid\s+(\w+)\s*\(/.exec(raw[i] ?? '');
        const above = annotationsAbove(i);
        if (m && /@(Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/.test(above)) push(i, (m[1] ?? m[2] ?? m[3]) as string, /@(Disabled|Ignore)\b/.test(above));
        return;
      }
      case 'csharp': {
        m = /\b(?:void|Task)\s+(\w+)\s*\(/.exec(line);
        const above = annotationsAbove(i);
        if (m && /\[\s*(Fact|Theory|Test|TestMethod|TestCase)\b/.test(above)) push(i, m[1] as string, /\[\s*Ignore\b|\bSkip\s*=/.test(above));
        return;
      }
      case 'php':
        m = /\bfunction\s+(\w+)\s*\(/.exec(line);
        if (m && (/^test/.test(m[1] as string) || /#\[\s*Test\b/.test(annotationsAbove(i)) || /@test\b/.test(raw.slice(Math.max(0, i - 6), i).join(' ')))) push(i, m[1] as string, false);
        return;
      case 'swift':
        m = /\bfunc\s+(test\w*)\s*\(/.exec(line);
        if (m) push(i, m[1] as string, false);
        return;
      default:
        return;
    }
  });
  return out;
}

function extractEndBlocks(text: string, path: string): TestFile {
  const kind = sourceKind(path);
  const raw = splitLines(text);
  const commentless = splitLines(withoutComments(text, path));
  const code = splitLines(maskCode(text, maskFamily(path)));
  const out: TestCase[] = [];
  const groupLines = new Map<string, number>();
  const groups: Array<{ indent: number; title: string; skipped: boolean }> = [];
  code.forEach((line, i) => {
    if (line.trim() === '') return;
    const indent = indentOf(line);
    while (groups.length > 0 && (groups[groups.length - 1] as { indent: number }).indent >= indent) groups.pop();
    const rawLine = raw[i] ?? '';
    const opener = kind === 'ruby' ? /^\s*(x|f)?(describe|context|feature)\b\s*\(?\s*(?:(['"])(.*?)\3|([\w:]+))/.exec(rawLine) : /^\s*describe\s+"([^"]*)"/.exec(rawLine);
    if (opener) {
      const title = kind === 'ruby' ? (opener[4] ?? opener[5] ?? '') : (opener[1] ?? '');
      groups.push({ indent, title, skipped: kind === 'ruby' && opener[1] === 'x' });
      const key = groups.map((g) => g.title).join(' > ');
      if (!groupLines.has(key)) groupLines.set(key, i + 1);
      return;
    }
    const test =
      kind === 'ruby' ? /^\s*(x|f)?(it|specify|example|scenario|test)\b\s*\(?\s*(['"])(.*?)\3|^\s*def\s+(test_\w+)/.exec(rawLine) : /^\s*test\s+"([^"]*)"/.exec(rawLine);
    if (!test) return;
    const name = kind === 'ruby' ? (test[4] ?? test[5] ?? '') : (test[1] ?? '');
    const skipped = groups.some((g) => g.skipped) || (kind === 'ruby' && (test[1] === 'x' || /,\s*(:skip\b|skip:)/.test(rawLine)));
    const body = normalizeWhitespace(indentBody(commentless, i, true).text);
    const group = groups.map((g) => g.title).join(' > ');
    out.push({ title: group ? `${group} > ${name}` : name, name, line: i + 1, body, expanded: body, skipped, group });
  });
  return { tests: out, groups: groupLines };
}

/** Test cases in a test file, or null when the file cannot be read reliably (syntax errors). */
export function extractTests(text: string, path: string, lang: Lang): TestFile | null {
  switch (sourceKind(path)) {
    case 'js':
      return extractJs(text, lang);
    case 'python':
      return extractPython(text, path);
    case 'ruby':
    case 'elixir':
      return extractEndBlocks(text, path);
    case 'other':
      return { tests: [], groups: new Map() };
    default:
      return { tests: extractBrace(text, path), groups: new Map() };
  }
}

/** Identifiers used in a piece of code. */
export function identifiersIn(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0]);
  return out;
}

function tokenBag(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of s.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?/g) ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Number of identifier, number, and word tokens in a body. */
export function tokenCount(s: string): number {
  let n = 0;
  for (const c of tokenBag(s).values()) n += c;
  return n;
}

/**
 * Share of the old body's tokens (identifiers, numbers, words in strings)
 * that are still in the new body. Punctuation is left out: it makes any two
 * short tests look alike. A test that was extended keeps a share near 1.
 */
export function bodyContainment(oldBody: string, newBody: string): number {
  const a = tokenBag(oldBody);
  const b = tokenBag(newBody);
  let total = 0;
  let kept = 0;
  for (const [t, n] of a) {
    total += n;
    kept += Math.min(n, b.get(t) ?? 0);
  }
  return total === 0 ? 0 : kept / total;
}

/** Share of the old title's words that are still in the new title. */
export function titleContainment(oldTitle: string, newTitle: string): number {
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w !== 's' && w !== 'd'));
  const a = words(oldTitle);
  const b = words(newTitle);
  if (a.size === 0) return 0;
  let kept = 0;
  for (const w of a) if (b.has(w)) kept++;
  return kept / a.size;
}
