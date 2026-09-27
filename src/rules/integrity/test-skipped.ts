import type { CallExpression, Node } from '@babel/types';
import { splitLines } from '../../core/diff.ts';
import { bindingNames, propertyName, stringValue, unwrap } from '../../lang/js.ts';
import { parseSource } from '../../lang/parse.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import type { DiffContext, FileInfo, Rule } from '../types.ts';
import { type Occurrence, changesOf, isTestFile, maskCode, maskFamily, newOccurrences, normalizeWhitespace, prepareRun, snippet, sourceKind } from './shared.ts';

/**
 * Tests turned off in the change: `.skip`, `.only`, `xit`, `fit`,
 * `test.todo`, Playwright `test.fixme`, constant `skipIf`/`runIf`, and the
 * equivalent forms in Python, Go, Rust, Java, Kotlin, Ruby, C#, PHP, Elixir,
 * and Swift. Only skips added in the change are reported; a skip that already
 * existed at the base, or that only moved, is not.
 *
 * Conditional skips with a real condition (`skipIf(isWindows)`, Go's
 * `if testing.Short() { t.Skip() }`) are deliberate platform or mode checks
 * and are not reported.
 */

export interface SkipHit extends Occurrence {
  column: number;
  /** The construct as written, for example `describe.skip` or `@pytest.mark.skip`. */
  kind: string;
  title: string | null;
  how: 'skip' | 'focus' | 'todo' | 'always-skip' | 'never-run' | 'may-fail';
  /** A describe-like block: the skip covers several tests. */
  group: boolean;
}

const TEST_FNS = new Set(['describe', 'it', 'test', 'suite', 'context', 'specify', 'Deno.test']);
const GROUP_FNS = new Set(['describe', 'suite', 'context']);
const HOOK_FNS = new Set(['before', 'beforeEach', 'after', 'afterEach', 'beforeAll', 'afterAll']);
const DISABLED_FNS = new Map<string, 'skip' | 'focus'>([
  ['xit', 'skip'],
  ['xtest', 'skip'],
  ['xdescribe', 'skip'],
  ['xcontext', 'skip'],
  ['xspecify', 'skip'],
  ['xsuite', 'skip'],
  ['fit', 'focus'],
  ['fdescribe', 'focus'],
  ['fcontext', 'focus'],
]);
const MODIFIERS = new Set(['skip', 'only', 'todo', 'fixme', 'skipIf', 'runIf', 'if', 'ignore']);

interface Chain {
  root: string;
  props: Array<{ name: string; node: Node }>;
  /** The callee contains a call (`test.skipIf(x)(...)`, `it.each(t)(...)`). */
  nested: boolean;
}

function chainOf(callee: Node): Chain | null {
  const props: Chain['props'] = [];
  let n: Node | null = callee;
  let nested = false;
  while (n) {
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      const name = propertyName(n);
      if (name === null) return null;
      props.unshift({ name, node: n.property as Node });
      n = n.object as Node;
    } else if (n.type === 'CallExpression' || n.type === 'OptionalCallExpression') {
      nested = true;
      n = n.callee as Node;
    } else if (n.type === 'Identifier') {
      if (n.name === 'Deno' && props[0]?.name === 'test') return { root: 'Deno.test', props: props.slice(1), nested };
      return { root: n.name, props, nested };
    } else if (n.type === 'ThisExpression') {
      return { root: 'this', props, nested };
    } else if (n.type === 'TSNonNullExpression' || n.type === 'ParenthesizedExpression') {
      n = n.expression as Node;
    } else {
      return null;
    }
  }
  return null;
}

/** Truth value of a constant expression, or null when it depends on anything at runtime. */
export function constantTruth(node: Node | null | undefined): boolean | null {
  const n = unwrap(node);
  if (!n) return null;
  switch (n.type) {
    case 'BooleanLiteral':
      return n.value;
    case 'NumericLiteral':
      return n.value !== 0;
    case 'StringLiteral':
      return n.value !== '';
    case 'NullLiteral':
      return false;
    case 'Identifier':
      return n.name === 'undefined' ? false : null;
    case 'TemplateLiteral':
      return n.expressions.length === 0 ? n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('') !== '' : null;
    case 'UnaryExpression': {
      if (n.operator === 'void') return false;
      if (n.operator !== '!') return null;
      const inner = constantTruth(n.argument);
      return inner === null ? null : !inner;
    }
    default:
      return null;
  }
}

function titleOf(node: Node | undefined, text: string): string | null {
  if (!node) return null;
  const value = stringValue(node);
  if (value !== null) return value;
  const n = unwrap(node);
  if (n?.type === 'TemplateLiteral') return n.quasis.map((q) => q.value.raw).join('${}');
  if (n && n.start != null && n.end != null && !isFunctionNode(n)) return snippet(text.slice(n.start, n.end), 50);
  return null;
}

function isFunctionArg(node: Node | undefined): boolean {
  const n = node ? unwrap(node) : null;
  return !!n && isFunctionNode(n);
}

/** Inside an if, ternary, logical expression, switch case, or catch, below the given function. */
function isConditional(parents: readonly Node[], stopAt: Node | null): boolean {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p === stopAt) return false;
    if (p.type === 'IfStatement' || p.type === 'ConditionalExpression' || p.type === 'LogicalExpression' || p.type === 'SwitchCase' || p.type === 'CatchClause') return true;
    if (isFunctionNode(p)) return false;
  }
  return false;
}

interface TestCallback {
  fn: Node;
  call: CallExpression;
  chain: Chain;
}

/** The nearest function in `parents` passed directly to a test or hook call. */
function enclosingTestCallback(parents: readonly Node[], opts: { nonArrow: boolean; hooks: boolean }): TestCallback | null {
  for (let i = parents.length - 1; i >= 1; i--) {
    const fn = parents[i] as Node;
    if (!isFunctionNode(fn)) continue;
    if (opts.nonArrow && fn.type === 'ArrowFunctionExpression') continue;
    const parent = parents[i - 1] as Node;
    if (parent.type !== 'CallExpression' || !(parent.arguments as Node[]).includes(fn)) {
      if (opts.nonArrow) return null;
      continue;
    }
    const chain = chainOf(parent.callee as Node);
    if (!chain) return null;
    if (TEST_FNS.has(chain.root) || DISABLED_FNS.has(chain.root) || (opts.hooks && HOOK_FNS.has(chain.root))) return { fn, call: parent as CallExpression, chain };
    return null;
  }
  return null;
}

function paramNames(fn: Node): string[] {
  const params = (fn as { params?: Node[] }).params ?? [];
  return params.flatMap((p) => bindingNames(p));
}

function isParamOfEnclosingFunction(name: string, parents: readonly Node[]): boolean {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (isFunctionNode(p) && paramNames(p).includes(name)) return true;
  }
  return false;
}

/** Skips, focuses, and todos in a JavaScript or TypeScript test file. */
export function findJsSkips(text: string, lang: FileInfo['lang']): SkipHit[] | null {
  const parsed = parseSource(text, lang);
  if (parsed.blocks.length === 0) return null;
  const hits: SkipHit[] = [];
  let lines: string[] | null = null;
  const add = (node: Node, kind: string, title: string | null, how: SkipHit['how'], group: boolean) => {
    const line = node.loc?.start.line ?? 1;
    lines ??= splitLines(text);
    hits.push({ line, column: (node.loc?.start.column ?? 0) + 1, kind, title, how, group, sig: `${kind}|${title ?? normalizeWhitespace(lines[line - 1] ?? '')}` });
  };
  for (const block of parsed.blocks) {
    walk(block.program.program, {
      enter(node, parents) {
        if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
        const call = node as CallExpression;
        const chain = chainOf(call.callee as Node);
        if (!chain || chain.nested) return;
        const outer = parents[parents.length - 1];
        const outerCall = outer && outer.type === 'CallExpression' && outer.callee === node ? (outer as CallExpression) : null;
        const args = call.arguments as Node[];
        const titleArgs = outerCall ? (outerCall.arguments as Node[]) : args;
        const names = chain.props.map((p) => p.name);

        // this.skip() in a Mocha test or hook.
        if (chain.root === 'this') {
          if (names.length !== 1 || names[0] !== 'skip') return;
          const cb = enclosingTestCallback(parents, { nonArrow: true, hooks: true });
          if (!cb || isConditional(parents, cb.fn)) return;
          add(call, 'this.skip()', titleOf((cb.call.arguments as Node[])[0], text), 'skip', false);
          return;
        }

        // t.skip() / ctx.skip() / skip() on the test context (node:test, Vitest).
        const cb = enclosingTestCallback(parents, { nonArrow: false, hooks: false });
        if (cb) {
          const first = ((cb.fn as { params?: Node[] }).params ?? [])[0];
          const contextNames = first ? bindingNames(first) : [];
          const isContextSkip =
            (first?.type === 'Identifier' && chain.root === first.name && names.length === 1 && (names[0] === 'skip' || names[0] === 'todo')) ||
            (first?.type === 'ObjectPattern' && names.length === 0 && (chain.root === 'skip' || chain.root === 'todo') && contextNames.includes(chain.root));
          if (isContextSkip) {
            if (isConditional(parents, cb.fn)) return;
            const cond = args[0];
            if (cond && stringValue(cond) === null && constantTruth(cond) !== true) return; // skip(condition): conditional
            const kind = names.length ? `${chain.root}.${names[0]}()` : `${chain.root}()`;
            add(call, kind, titleOf((cb.call.arguments as Node[])[0], text), names[0] === 'todo' || chain.root === 'todo' ? 'todo' : 'skip', false);
            return;
          }
        }

        // xit, xdescribe, fit, fdescribe (optionally .each).
        const disabled = DISABLED_FNS.get(chain.root);
        if (disabled && names.every((n) => n === 'each')) {
          if (isParamOfEnclosingFunction(chain.root, parents)) return;
          add(call.callee as Node, chain.root, titleOf(titleArgs[0], text), disabled, /describe|context|suite/.test(chain.root));
          return;
        }

        if (!TEST_FNS.has(chain.root) || isParamOfEnclosingFunction(chain.root.split('.')[0] as string, parents)) return;
        const mIndex = chain.props.findIndex((p) => MODIFIERS.has(p.name));
        const group = GROUP_FNS.has(chain.root) || names.slice(0, mIndex === -1 ? names.length : mIndex).some((n) => GROUP_FNS.has(n));
        if (mIndex === -1) {
          // test('x', { skip: true }, fn): node:test, Vitest, and Deno options objects.
          for (const arg of args) {
            const obj = unwrap(arg);
            if (obj?.type !== 'ObjectExpression') continue;
            for (const prop of obj.properties) {
              if (prop.type !== 'ObjectProperty') continue;
              const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
              if (key !== 'skip' && key !== 'only' && key !== 'todo' && key !== 'ignore') continue;
              const truth = stringValue(prop.value as Node) !== null ? true : constantTruth(prop.value as Node);
              if (truth !== true) continue;
              const title = titleOf(args[0] === arg ? objectName(obj) : args[0], text);
              add(prop, `{ ${key}: ${snippet(text.slice(prop.value.start ?? 0, prop.value.end ?? 0), 20)} }`, title, key === 'only' ? 'focus' : key === 'todo' ? 'todo' : 'skip', group);
            }
          }
          return;
        }
        const modifier = chain.props[mIndex] as { name: string; node: Node };
        const kind = [chain.root, ...names.slice(0, mIndex + 1)].join('.');
        const title = titleOf(titleArgs[0], text);
        switch (modifier.name) {
          case 'only':
            add(modifier.node, kind, title, 'focus', group);
            return;
          case 'todo':
            add(modifier.node, kind, title, 'todo', group);
            return;
          case 'ignore':
            if (chain.root === 'Deno.test') add(modifier.node, kind, title, 'skip', group);
            return;
          case 'skipIf': {
            if (constantTruth(args[0]) === true) add(modifier.node, `${kind}(${snippet(sourceOf(args[0], text), 12)})`, titleOf(titleArgs[0], text), 'always-skip', group);
            return;
          }
          case 'runIf':
          case 'if': {
            if (constantTruth(args[0]) === false) add(modifier.node, `${kind}(${snippet(sourceOf(args[0], text), 12)})`, titleOf(titleArgs[0], text), 'never-run', group);
            return;
          }
          case 'skip':
          case 'fixme': {
            // Playwright: test.skip() inside a test, test.skip(condition, reason), test.skip(title, fn).
            const bare = chain.root === 'test' && mIndex === 0 && !outerCall;
            if (bare && !isFunctionArg(args[1]) && !(args[0] && stringValue(args[0]) !== null && args.length === 1)) {
              if (args.length === 0) {
                const inTest = enclosingTestCallback(parents, { nonArrow: false, hooks: true });
                if (isConditional(parents, inTest?.fn ?? null)) return;
                add(modifier.node, `${kind}()`, inTest ? titleOf((inTest.call.arguments as Node[])[0], text) : null, 'skip', false);
                return;
              }
              const cond = args[0] as Node;
              const fnBody = isFunctionArg(cond) ? (unwrap(cond) as { body?: Node }).body : null;
              const truth = fnBody ? (fnBody.type === 'BlockStatement' ? null : constantTruth(fnBody)) : constantTruth(cond);
              if (truth !== true) return; // a real condition: a deliberate, conditional skip
              const inTest = enclosingTestCallback(parents, { nonArrow: false, hooks: true });
              add(modifier.node, `${kind}(${snippet(sourceOf(cond, text), 12)})`, inTest ? titleOf((inTest.call.arguments as Node[])[0], text) : null, 'always-skip', group);
              return;
            }
            add(modifier.node, kind, title, 'skip', group);
            return;
          }
          default:
            return;
        }
      },
    });
  }
  return hits;
}

/** The `name` of an options object (Deno.test({ name, ignore, fn })). */
function objectName(obj: Node): Node | undefined {
  if (obj.type !== 'ObjectExpression') return undefined;
  for (const prop of obj.properties) {
    if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier' && prop.key.name === 'name') return prop.value as Node;
  }
  return undefined;
}

function sourceOf(node: Node | undefined, text: string): string {
  if (!node || node.start == null || node.end == null) return '';
  return text.slice(node.start, node.end);
}

// ---------------------------------------------------------------------------
// Other languages (masked text)

interface LineInfo {
  raw: string[];
  code: string[];
  maskedText: string;
  starts: number[];
}

function lineInfo(text: string, path: string): LineInfo {
  const masked = maskCode(text, maskFamily(path));
  const starts = [0];
  for (let i = 0; i < masked.length; i++) if (masked.charCodeAt(i) === 10) starts.push(i + 1);
  return { raw: splitLines(text), code: splitLines(masked), maskedText: masked, starts };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** For indentation languages: the nearest enclosing block opener above a line. */
function blockOpener(code: string[], index: number): string | null {
  const indent = indentOf(code[index] ?? '');
  for (let j = index - 1; j >= 0; j--) {
    const line = code[j] ?? '';
    if (line.trim() === '' || line.trim().startsWith('@')) continue;
    if (indentOf(line) < indent) return line.trim();
  }
  return null;
}

/** For brace languages: the text of the line that opens the block around an offset. */
function braceOpener(info: LineInfo, offset: number): string | null {
  let depth = 0;
  for (let k = offset - 1; k >= 0; k--) {
    const ch = info.maskedText[k];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        const line = lineAt(info, k);
        return (info.code[line - 1] ?? '').trim();
      }
      depth--;
    }
  }
  return null;
}

function lineAt(info: LineInfo, offset: number): number {
  let lo = 0;
  let hi = info.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((info.starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const CONDITIONAL_BRACE = /^(\}\s*)?(if|else|switch|case|select|for|foreach|while|catch|guard|when|unless)\b|^default\s*:|^\}\s*else\b/;

/** Name of the next function or method declared below a line (the test a decorator or annotation applies to). */
function nextDeclaration(info: LineInfo, index: number, re: RegExp): string | null {
  for (let j = index + 1; j < Math.min(info.code.length, index + 12); j++) {
    const m = re.exec(info.raw[j] ?? '');
    if (m) return m[1] ?? m[2] ?? null;
  }
  return null;
}

/** Name of the function or test enclosing a line. */
function enclosingDeclaration(info: LineInfo, index: number, re: RegExp): string | null {
  for (let j = index; j >= 0; j--) {
    const m = re.exec(info.raw[j] ?? '');
    if (m) return m[1] ?? m[2] ?? null;
  }
  return null;
}

/** Arguments of a call that starts at a line (balanced parentheses, up to 20 lines), from the raw text. */
function callArgs(info: LineInfo, index: number, from: number): string | null {
  let depth = 0;
  let out = '';
  let started = false;
  for (let j = index; j < Math.min(info.code.length, index + 20); j++) {
    const code = info.code[j] ?? '';
    const raw = info.raw[j] ?? '';
    for (let k = j === index ? from : 0; k < code.length; k++) {
      const ch = code[k];
      if (ch === '(') {
        depth++;
        if (!started) {
          started = true;
          continue;
        }
      } else if (ch === ')') {
        depth--;
        if (started && depth === 0) return out;
      } else if (!started && ch !== ' ' && ch !== '\t') {
        return null;
      }
      if (started) out += raw[k] ?? '';
    }
    if (!started) return null;
    out += '\n';
  }
  return started ? out : null;
}

function splitTopLevel(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (const ch of args) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const PY_DEF = /^\s*(?:async\s+)?def\s+(\w+)/;
const PY_CONST_TRUE = /^(True|1)$/;

function findPythonSkips(text: string, path: string, xfailStrict: boolean): SkipHit[] {
  const info = lineInfo(text, path);
  const hits: SkipHit[] = [];
  const add = (index: number, column: number, kind: string, title: string | null, how: SkipHit['how']) =>
    hits.push({ line: index + 1, column: column + 1, kind, title, how, group: false, sig: `${kind}|${title ?? normalizeWhitespace(info.raw[index] ?? '')}` });
  info.code.forEach((code, i) => {
    const deco = /^(\s*)@\s*(pytest\.mark\.(skipif|skip|xfail)|unittest\.(skipIf|skipUnless|skip)|(skipIf|skipUnless|skip))\b/.exec(code);
    if (deco) {
      const name = deco[2] as string;
      const short = (deco[3] ?? deco[4] ?? deco[5]) as string;
      const argsText = callArgs(info, i, (deco.index ?? 0) + deco[0].length);
      const args = argsText === null ? [] : splitTopLevel(argsText);
      const positional = args.filter((a) => !/^\w+\s*=/.test(a));
      const kw = (key: string) => args.find((a) => new RegExp(`^${key}\\s*=`).test(a))?.replace(/^\w+\s*=\s*/, '');
      const title = nextDeclaration(info, i, PY_DEF) ?? enclosingDeclaration(info, i, /^\s*class\s+(\w+)/);
      if (short === 'skip') add(i, deco[1]?.length ?? 0, `@${name}`, title, 'skip');
      else if (short === 'skipif' || short === 'skipIf') {
        const cond = positional[0] ?? kw('condition');
        if (cond && /^(True|1)$/.test(cond.trim())) add(i, deco[1]?.length ?? 0, `@${name}(${cond.trim()})`, title, 'always-skip');
      } else if (short === 'skipUnless') {
        const cond = positional[0];
        if (cond && /^(False|0|None)$/.test(cond.trim())) add(i, deco[1]?.length ?? 0, `@${name}(${cond.trim()})`, title, 'never-run');
      } else if (short === 'xfail') {
        const strict = kw('strict');
        const run = kw('run');
        // A string condition is an expression pytest evaluates, not a constant.
        const cond = positional[0] ?? kw('condition');
        const unconditional = cond === undefined || PY_CONST_TRUE.test(cond.trim());
        if (run && /^False$/.test(run.trim()) && unconditional) add(i, deco[1]?.length ?? 0, `@${name}(run=False)`, title, 'skip');
        else if (unconditional && !(strict ? /^True$/.test(strict.trim()) : xfailStrict)) add(i, deco[1]?.length ?? 0, `@${name}`, title, 'may-fail');
      }
      return;
    }
    const mark = /^\s*pytestmark\s*=\s*\[?.*\bpytest\.mark\.skip\b(?!if)/.exec(code);
    if (mark) {
      add(i, indentOf(code), 'pytestmark = pytest.mark.skip', null, 'skip');
      return;
    }
    const call = /\b(pytest\.skip|self\.skipTest|(?:unittest\.)?SkipTest)\s*\(/.exec(code);
    if (call && !/\bimportorskip\b/.test(code)) {
      if (call[1]?.endsWith('SkipTest') && !/\braise\s+(unittest\.)?SkipTest\b/.test(code)) return;
      const opener = blockOpener(info.code, i);
      const topLevel = indentOf(code) === 0;
      if (topLevel) {
        if (!/allow_module_level\s*=\s*True/.test(info.raw[i] ?? '')) return;
      } else if (!opener || !/^(async\s+)?def\s/.test(opener)) return; // inside if/try/with/for: conditional
      add(i, call.index ?? 0, `${call[1]}()`, topLevel ? null : enclosingDeclaration(info, i, PY_DEF), 'skip');
    }
  });
  return hits;
}

function findBraceSkips(text: string, path: string): SkipHit[] {
  const kind = sourceKind(path);
  const info = lineInfo(text, path);
  const hits: SkipHit[] = [];
  const add = (index: number, column: number, what: string, title: string | null, how: SkipHit['how'] = 'skip') =>
    hits.push({ line: index + 1, column: column + 1, kind: what, title, how, group: false, sig: `${what}|${title ?? normalizeWhitespace(info.raw[index] ?? '')}` });
  const unconditional = (index: number, column: number) => {
    const opener = braceOpener(info, (info.starts[index] ?? 0) + column);
    return opener !== null && !CONDITIONAL_BRACE.test(opener);
  };
  if (kind === 'go') {
    const receivers = new Set<string>();
    for (const m of info.maskedText.matchAll(/\b([A-Za-z_]\w*)\s+\*?testing\.(?:T|TB)\b/g)) receivers.add(m[1] as string);
    info.code.forEach((code, i) => {
      for (const m of code.matchAll(/\b([A-Za-z_]\w*)\.(Skip|Skipf|SkipNow)\s*\(|\.T\(\)\.(Skip|Skipf|SkipNow)\s*\(/g)) {
        const receiver = m[1];
        if (receiver !== undefined && !receivers.has(receiver)) continue;
        if (!unconditional(i, m.index ?? 0)) continue;
        add(i, m.index ?? 0, `${receiver ?? 'T()'}.${m[2] ?? m[3]}()`, enclosingDeclaration(info, i, /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)|\bt\.Run\(\s*"([^"]+)"/));
      }
    });
  } else if (kind === 'rust') {
    info.code.forEach((code, i) => {
      const m = /^\s*#\[\s*ignore\b/.exec(code);
      if (m) add(i, indentOf(code), '#[ignore]', nextDeclaration(info, i, /\bfn\s+(\w+)/));
    });
  } else if (kind === 'java' || kind === 'kotlin') {
    const decl = /\bfun\s+(?:`([^`]+)`|(\w+))|\bvoid\s+(\w+)\s*\(/;
    const name = (index: number) => {
      for (let j = index + 1; j < Math.min(info.raw.length, index + 12); j++) {
        const m = decl.exec(info.raw[j] ?? '');
        if (m) return m[1] ?? m[2] ?? m[3] ?? null;
      }
      return null;
    };
    info.code.forEach((code, i) => {
      let m = /^\s*@(Disabled|Ignore)\b(?![.\w])/.exec(code);
      if (m) return void add(i, indentOf(code), `@${m[1]}`, name(i));
      m = /@Test\s*\([^)]*\benabled\s*=\s*false\b/.exec(code);
      if (m) return void add(i, m.index ?? 0, '@Test(enabled = false)', name(i));
      if (kind === 'kotlin') {
        m = /^\s*(x(?:it|test|describe|context|should|given|when|then|feature|scenario|expect))\s*\(/.exec(code);
        if (m) return void add(i, indentOf(code), m[1] as string, /\(\s*"([^"]*)"/.exec(info.raw[i] ?? '')?.[1] ?? null);
        m = /\.config\s*\([^)]*\benabled\s*=\s*false\b/.exec(code);
        if (m) add(i, m.index ?? 0, '.config(enabled = false)', null);
      }
    });
  } else if (kind === 'csharp') {
    info.code.forEach((code, i) => {
      let m = /\[\s*(Fact|Theory)\s*\([^)\]]*\bSkip\s*=/.exec(code);
      if (m) return void add(i, m.index ?? 0, `[${m[1]}(Skip = ...)]`, nextDeclaration(info, i, /\b(?:void|Task)\s+(\w+)\s*\(/));
      m = /\[\s*Ignore\s*(\(|\]|,)/.exec(code);
      if (m) return void add(i, m.index ?? 0, '[Ignore]', nextDeclaration(info, i, /\b(?:void|Task)\s+(\w+)\s*\(/));
      m = /\bAssert\.Ignore\s*\(/.exec(code);
      if (m && unconditional(i, m.index ?? 0)) add(i, m.index ?? 0, 'Assert.Ignore()', enclosingDeclaration(info, i, /\b(?:void|Task)\s+(\w+)\s*\(/));
    });
  } else if (kind === 'php') {
    info.code.forEach((code, i) => {
      const m = /(\$this->|self::|static::)(markTestSkipped|markTestIncomplete)\s*\(/.exec(code);
      if (m && unconditional(i, m.index ?? 0)) add(i, m.index ?? 0, `${m[1]}${m[2]}()`, enclosingDeclaration(info, i, /\bfunction\s+(\w+)\s*\(/));
    });
  } else if (kind === 'swift') {
    info.code.forEach((code, i) => {
      let m = /\bthrow\s+XCTSkip\s*\(/.exec(code);
      if (m && unconditional(i, m.index ?? 0)) return void add(i, m.index ?? 0, 'throw XCTSkip()', enclosingDeclaration(info, i, /\bfunc\s+(\w+)/));
      m = /\bXCTSkipIf\s*\(\s*true\b|\bXCTSkipUnless\s*\(\s*false\b/.exec(code);
      if (m) add(i, m.index ?? 0, snippet(m[0], 20), enclosingDeclaration(info, i, /\bfunc\s+(\w+)/), 'always-skip');
    });
  }
  return hits;
}

function findIndentSkips(text: string, path: string): SkipHit[] {
  const kind = sourceKind(path);
  const info = lineInfo(text, path);
  const hits: SkipHit[] = [];
  const add = (index: number, column: number, what: string, title: string | null, how: SkipHit['how'] = 'skip') =>
    hits.push({ line: index + 1, column: column + 1, kind: what, title, how, group: false, sig: `${what}|${title ?? normalizeWhitespace(info.raw[index] ?? '')}` });
  const titleOnLine = (i: number) => /^\s*\w+\s*\(?\s*(['"])(.*?)\1/.exec(info.raw[i] ?? '')?.[2] ?? null;
  if (kind === 'ruby') {
    info.code.forEach((code, i) => {
      let m = /^\s*(x|f)(it|describe|context|specify|example|feature|scenario)\b(?![?!=])/.exec(code);
      if (m) return void add(i, indentOf(code), `${m[1]}${m[2]}`, titleOnLine(i), m[1] === 'f' ? 'focus' : 'skip');
      m = /^\s*(it|describe|context|specify|example|feature|scenario)\b.*,\s*(:skip\b|skip:\s*(?!false\b|nil\b)|:focus\b|focus:\s*true\b)/.exec(code);
      if (m) return void add(i, indentOf(code), `${m[1]} ${m[2]?.startsWith(':') ? m[2] : (m[2] ?? '').replace(/\s+$/, '')}`, titleOnLine(i), /focus/.test(m[2] ?? '') ? 'focus' : 'skip');
      m = /^\s*skip\b(?![?!=:])/.exec(code);
      if (m && !/\b(if|unless)\b/.test(code.slice((m.index ?? 0) + m[0].length))) {
        const opener = blockOpener(info.code, i);
        if (!opener || !/^(it|specify|example|scenario|test|def)\b/.test(opener)) return;
        add(i, indentOf(code), 'skip', /(['"])(.*?)\1/.exec(opener)?.[2] ?? /^def\s+(\w+)/.exec(opener)?.[1] ?? null);
      }
    });
  } else if (kind === 'elixir') {
    info.code.forEach((code, i) => {
      const m = /^\s*@(tag|moduletag|describetag)\s+(:skip\b|skip:\s*(?!false\b|nil\b))/.exec(code);
      if (m) add(i, indentOf(code), `@${m[1]} :skip`, nextDeclaration(info, i, /^\s*(?:test|describe)\s+"([^"]*)"/));
    });
  }
  return hits;
}

function pythonXfailStrict(ctx: DiffContext): boolean {
  for (const file of ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']) {
    const text = ctx.project.read(file);
    if (text && /^\s*xfail_strict\s*=\s*(true|1)\b/im.test(text)) return true;
  }
  return false;
}

/** Skips in any supported test file, or null when the file cannot be read as code. */
export function findSkips(text: string, file: FileInfo, ctx?: DiffContext): SkipHit[] | null {
  switch (sourceKind(file.path)) {
    case 'js':
      return findJsSkips(text, file.lang);
    case 'python':
      return findPythonSkips(text, file.path, ctx ? pythonXfailStrict(ctx) : false);
    case 'ruby':
    case 'elixir':
      return findIndentSkips(text, file.path);
    case 'other':
      return [];
    default:
      return findBraceSkips(text, file.path);
  }
}

/** Cheap pre-filter on added lines before any parsing. */
const QUICK =
  /\.(skip|only|todo|fixme|skipIf|runIf|if|ignore|Skip|Skipf|SkipNow)\b|\b[xf](it|test|describe|context|specify|suite|example|feature|scenario|should|given|when|then|expect)\b|\b(skip|only|todo|ignore)\s*[:(]|\bpytest\b|\bunittest\b|skipTest|SkipTest|skipIf|skipUnless|#\[\s*ignore|@Disabled|@Ignore|enabled\s*=\s*false|\[\s*(Ignore|Fact|Theory)|Assert\.Ignore|markTest|@(tag|moduletag|describetag)\b|XCTSkip|^\s*skip\b/m;

function messageFor(hit: SkipHit): string {
  const title = hit.title ? ` "${snippet(hit.title, 60)}"` : '';
  const what = hit.group ? `the tests in${title || ' this block'}` : title ? `the test${title}` : 'this test';
  switch (hit.how) {
    case 'focus':
      return `\`${hit.kind}\` runs only ${what} and skips the others.`;
    case 'todo':
      return `\`${hit.kind}\` declares${title || ' a test'} without a body, so nothing is tested.`;
    case 'always-skip':
      return `\`${hit.kind}\` has a constant condition, so it always skips ${what}.`;
    case 'never-run':
      return `\`${hit.kind}\` has a constant condition, so ${what} never ${hit.group ? 'run' : 'runs'}.`;
    case 'may-fail':
      return `\`${hit.kind}\` without \`strict=True\` lets ${what} fail without failing the run.`;
    default:
      return `\`${hit.kind}\` skips ${what}.`;
  }
}

function fixFor(hit: SkipHit): string {
  switch (hit.how) {
    case 'focus':
      return `Remove the focus (\`${hit.kind}\`) so the whole suite runs.`;
    case 'todo':
      return 'Write the test instead of a todo; if a failing test was turned into a todo, restore it and fix the code.';
    case 'may-fail':
      return 'Fix the test or the code it tests; if the failure is a known bug, mark it `strict=True` and tell the user.';
    default:
      return 'Remove the skip and fix the test or the code it tests; if the test itself is wrong, tell the user instead of skipping it.';
  }
}

export const testSkipped: Rule = {
  meta: {
    id: 'integrity/test-skipped',
    level: 'block',
    scope: 'diff',
    title: 'Test skipped or focused in the change',
    summary:
      'A skip or focus added to a test file: `.skip`, `.only`, `xit`, `xdescribe`, `fit`, `test.todo`, Playwright `test.fixme` and `test.skip()`, a constant `skipIf`/`runIf`, `@pytest.mark.skip`, non-strict `xfail`, Go `t.Skip()`, Rust `#[ignore]`, JUnit `@Disabled`, RSpec `xit` and `skip`.',
    why: 'Coding agents skip failing tests to make a run pass instead of fixing the code (ImpossibleBench, 2025). A focused test (`.only`) silently turns off every other test in the file or run.',
    fix: 'Remove the skip and fix the test or the code it tests; if the test itself is wrong, tell the user instead of skipping it.',
    references: ['https://arxiv.org/abs/2510.20270'],
  },
  appliesTo: (file) => !file.generated && isTestFile(file.path),
  project: prepareRun,
  diff(ctx) {
    if (ctx.after === null) return;
    const changes = changesOf(ctx);
    if (changes.added.length === 0) return;
    if (!changes.added.some((l) => QUICK.test(l.text))) return;
    const after = findSkips(ctx.after, ctx.file, ctx);
    if (after === null || after.length === 0) return;
    const before = changes.before === null ? [] : findSkips(changes.before, ctx.file, ctx);
    if (before === null) return; // the base did not parse: no reliable comparison
    for (const hit of newOccurrences(after, before, changes.addedLines)) {
      ctx.report({
        line: hit.line,
        column: hit.column,
        message: messageFor(hit),
        fix: fixFor(hit),
        key: hit.sig,
      });
    }
  },
};
