import type { Node } from '@babel/types';
import type { Level, TraceStep } from '../../core/types.ts';
import {
  OPAQUE,
  OPTIONAL,
  type Taint,
  calleeName,
  enclosingFunction,
  hostFixed,
  isCallNode,
  isMemberNode,
  lineOf,
  memberPath,
  objectProp,
  propertyName,
  redirectPrefixSafe,
  stringValue,
  topLevelConst,
  unwrap,
} from '../../lang/js.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import type { FileInfo, JsContext } from '../types.ts';
import { type Sink, type SinkCategory, declarationInit } from './sinks.ts';

/**
 * Data flow at a sink: which taints still matter for it, which checks in the
 * same function clear it, and how findings describe the path. Shared by the
 * web and llm packs, which report different taint kinds at the same sinks so
 * that a sink is never reported twice.
 */

export interface LiveTaint {
  taint: Taint;
  /** The sink value the taint reached. */
  value: Node;
}

/** Sink categories llm/output-to-sink reports. The others belong to the web and tool rules only. */
export const OUTPUT_SINKS: ReadonlySet<SinkCategory> = new Set<SinkCategory>(['code', 'command', 'sql', 'html']);

/** True when a sanitizer, cast, or fixed URL prefix makes a taint harmless for this kind of sink. */
export function neutralized(t: Taint, category: SinkCategory, detail?: Sink['detail']): boolean {
  const via = t.via;
  // execaCommand splits on spaces without a shell: text after a fixed program only adds arguments.
  if (detail === 'argv' && /\S/.test((t.prefix ?? '').split(OPAQUE).join(''))) return true;
  if (via.includes('number')) return true;
  const encodedStart = via.includes('uri-component') && !t.prefix;
  switch (category) {
    case 'html':
      return via.includes('html-sanitizer') || via.includes('uri-component');
    case 'sql':
      return via.includes('sql-escape');
    case 'command':
      return via.includes('shell-escape') || via.includes('uri-component');
    case 'file-read':
    case 'file-write':
      return via.includes('basename') || via.includes('uri-component');
    case 'fetch':
      // A path without scheme and host (`/api/x`) cannot reach another server from server code.
      return t.ownUrl === true || hostFixed(t.prefix) || encodedStart || /^\/[^/\\]/.test((t.prefix ?? '').split(OPTIONAL).join('').split(OPAQUE).join('x'));
    case 'redirect':
      // A route parameter after a fixed '/' is one path segment: `/${slug}/settings`.
      if (t.source === 'route parameters' && /\/$/.test((t.prefix ?? '').split(OPTIONAL).join(''))) return true;
      return t.ownUrl === true || redirectPrefixSafe(t.prefix) || encodedStart;
    case 'code':
      return via.includes('json') && !t.prefix;
    default:
      return false;
  }
}

/** Taints of the sink values that are not neutralized for the sink. */
export function liveTaints(ctx: JsContext, sink: Sink): LiveTaint[] {
  const out: LiveTaint[] = [];
  for (const value of sink.values) {
    for (const taint of ctx.taint.taintsOf(value)) {
      if (!neutralized(taint, sink.category, sink.detail)) out.push({ taint, value });
    }
  }
  return out;
}

/** Every taint of the sink values, neutralized or not. */
export function anyTaint(ctx: JsContext, sink: Sink): boolean {
  return sink.values.some((v) => ctx.taint.taintsOf(v).length > 0);
}

/** Request data a server-side rule should report (browser-only sources excluded when `serverOnly`). */
export function requestTaint(live: LiveTaint[], serverOnly = false): LiveTaint | undefined {
  return live.find((l) => l.taint.kind === 'request' && (!serverOnly || !CLIENT_SOURCES.has(l.taint.source)));
}

const CLIENT_SOURCES = new Set(['the page URL', 'URL parameters', 'the referrer', 'the window name']);

/** True when a schema Ubon could not read validated the value (its constraints are unknown). */
export function schemaChecked(t: Taint): boolean {
  return t.via.includes('schema');
}

// ---------------------------------------------------------------------------
// Files and levels

/** Source files the taint rules check: not generated, not tests, not documentation. */
export function isCheckedCode(file: FileInfo): boolean {
  return !file.generated && !file.contexts.has('test') && !file.contexts.has('docs');
}

/** Example and template folders hold code people copy, but not deployed code: report at warn. */
export function contextLevel(file: FileInfo, level: Level): Level {
  return level === 'block' && file.contexts.has('example') ? 'warn' : level;
}

// ---------------------------------------------------------------------------
// Messages

/**
 * Name of the part of a value a message should point at: the first tainted
 * variable or property read (`url`, `req.body.path`), else the first part that
 * is not a constant, else the value itself. Callees are not values.
 */
export function valueLabel(ctx: JsContext, value: Node, taint?: Taint): string {
  let tainted: Node | null = null;
  // With a taint given, name the part that carries it (not another tainted part next to it).
  const carries = (node: Node) => {
    const taints = ctx.taint.taintsOf(node);
    if (!taint) return taints.length > 0;
    return taints.some((t) => t.kind === taint.kind && t.source === taint.source && t.line === taint.line);
  };
  let variable: Node | null = null;
  const callees = new Set<Node>();
  walk(value, {
    enter(node, parents) {
      if (tainted) return 'skip';
      if (node !== value && isFunctionNode(node)) return 'skip';
      const parent = parents[parents.length - 1];
      if (node.type === 'Identifier' && parent && isMemberNode(parent) && parent.property === node && !parent.computed) return undefined;
      // A keyed read such as params.get('next') is named as a whole.
      if (isCallNode(node) && callKey(node) && isMemberNode(node.callee) && !/\(\)/.test(memberPath(node.callee.object as Node) ?? '()') && carries(node)) {
        tainted = node;
        return 'skip';
      }
      if (parent && isCallNode(parent) && parent.callee === node) {
        callees.add(node);
        return undefined;
      }
      if (node.type === 'Identifier' || isMemberNode(node)) {
        if (carries(node)) {
          tainted = node;
          return 'skip';
        }
        // Inside a callee (`JSON` in JSON.stringify) only a tainted receiver is worth naming.
        const inCallee = parents.some((p) => callees.has(p));
        if (!variable && !inCallee && !(node.type === 'Identifier' && node.name === 'undefined')) variable = node;
        return isMemberNode(node) && !inCallee ? 'skip' : undefined;
      }
      return undefined;
    },
  });
  const chosen: Node = tainted ?? variable ?? value;
  const text = snippet(ctx.text, chosen);
  return shorten(text || memberPath(chosen) || 'value', 40);
}

export function snippet(text: string, node: Node): string {
  if (node.start == null || node.end == null) return 'value';
  return text.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
}

export function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** "(url, line 9)" */
export function where(label: string, t: Taint): string {
  return `(${label}, line ${t.line})`;
}

export function traceOf(label: string, t: Taint, sink: Sink, sinkNote?: string): TraceStep[] {
  const sinkLine = lineOf(sink.node);
  const steps: TraceStep[] = [{ line: t.line, note: `${label} comes from ${t.source}` }];
  steps.push({ line: sinkLine, note: sinkNote ?? `reaches ${sink.name}` });
  return steps;
}

// ---------------------------------------------------------------------------
// Constants

/** True when a value is built only from constants (literals, module constants, the source of local functions). */
export function isConstantValue(ctx: JsContext, node: Node | null | undefined, depth = 0): boolean {
  const n = unwrap(node);
  if (!n) return true;
  if (depth > 5) return false;
  const next = (x: Node | null | undefined) => isConstantValue(ctx, x, depth + 1);
  switch (n.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
    case 'RegExpLiteral':
      return true;
    case 'TemplateLiteral':
      return n.expressions.every((e) => next(e as Node));
    case 'TaggedTemplateExpression':
      return n.quasi.expressions.every((e) => next(e as Node));
    case 'BinaryExpression':
      return next(n.left as Node) && next(n.right);
    case 'UnaryExpression':
      return next(n.argument);
    case 'ConditionalExpression':
      return next(n.consequent) && next(n.alternate);
    case 'LogicalExpression':
      return next(n.left) && next(n.right);
    case 'ArrayExpression':
      return n.elements.every((e) => e === null || next(e as Node));
    case 'ObjectExpression':
      return n.properties.every((p) => p.type === 'ObjectProperty' && next(p.value as Node));
    case 'Identifier': {
      if (n.name === 'undefined') return true;
      const init = declarationInit(ctx, n.name) ?? topLevelConst(ctx.program, n.name);
      return init !== null && next(init);
    }
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const obj = unwrap(n.object as Node);
      const prop = propertyName(n);
      if (obj?.type === 'Identifier' && prop) {
        const init = unwrap(declarationInit(ctx, obj.name) ?? topLevelConst(ctx.program, obj.name));
        if (init?.type === 'ObjectExpression') return next(objectProp(init, prop));
      }
      return false;
    }
    case 'CallExpression':
    case 'OptionalCallExpression': {
      const callee = unwrap(n.callee as Node);
      const path = memberPath(callee) ?? '';
      if (path === 'JSON.stringify' || path === 'String') return n.arguments.every((a) => next(a as Node));
      if (callee && isMemberNode(callee)) {
        const method = propertyName(callee);
        const recv = unwrap(callee.object as Node);
        // The source text of a function defined in this file: `(${setTheme.toString()})()`
        if (method === 'toString' && recv?.type === 'Identifier' && isLocalFunction(ctx, recv.name)) return true;
        if (method && /^(join|trim|replace|replaceAll|toLowerCase|toUpperCase|concat|slice)$/.test(method)) return next(recv) && n.arguments.every((a) => next(a as Node));
      }
      return false;
    }
    default:
      return false;
  }
}

function isLocalFunction(ctx: JsContext, name: string): boolean {
  for (const stmt of ctx.program.program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type === 'FunctionDeclaration' && decl.id?.name === name) return true;
    if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const init = unwrap(d.init as Node | null);
        if (d.id.type === 'Identifier' && d.id.name === name && init && isFunctionNode(init)) return true;
      }
    }
  }
  const init = unwrap(declarationInit(ctx, name));
  return init !== null && isFunctionNode(init);
}

// ---------------------------------------------------------------------------
// Guards: checks in the same function that clear a finding

export type GuardKind = 'host' | 'allowlist' | 'regex' | 'path-prefix' | 'dotdot' | 'relative' | 'origin';

export interface GuardResult {
  cleared: boolean;
  /** Redirect targets checked for a leading '/' but not for '//'. */
  slashOnly?: boolean;
}

interface Family {
  names: Set<string>;
  paths: Set<string>;
}

interface Declared {
  names: string[];
  init: Node;
}

/**
 * Look for checks on the sink's value, earlier in the same function: host
 * allowlists, membership in a list, anchored regular expressions, path
 * containment, and same-origin checks for redirects. `helper` matches the
 * names of validation helpers that clear the finding when called with the
 * value.
 */
export function findGuard(ctx: JsContext, sink: Sink, live: LiveTaint[], kinds: readonly GuardKind[], helper?: (name: string) => boolean): GuardResult {
  const scope: Node = enclosingFunction(ctx.parents) ?? ctx.program.program;
  const sinkStart = sink.node.start ?? Number.MAX_SAFE_INTEGER;
  const declared = declarationsBefore(scope, sinkStart);
  const family = familyOf(ctx, live.map((l) => l.value), declared);
  if (family.names.size === 0 && family.paths.size === 0) return { cleared: false };
  const refers = (x: Node | null | undefined): boolean => refersTo(x, family);
  let cleared = false;
  let slash = false;
  let doubleSlash = false;
  const want = new Set(kinds);
  walk(scope, {
    enter(node) {
      if (cleared) return 'skip';
      if ((node.start ?? 0) >= sinkStart) return 'skip';
      if (node.type === 'BinaryExpression' && /^(===|!==|==|!=)$/.test(node.operator)) {
        const sides = [unwrap(node.left as Node), unwrap(node.right)];
        for (const side of sides) {
          if (side && isMemberNode(side) && /^(hostname|host|origin)$/.test(propertyName(side) ?? '') && refers(side.object as Node)) {
            if (want.has('host') || want.has('origin')) cleared = true;
          }
          // charAt / index checks on a redirect target: next[0] === '/' && next[1] !== '/'
          if (want.has('relative') && side && isMemberNode(side) && side.computed && refers(side.object as Node)) {
            const index = propertyName(side);
            const other = stringValue(sides.find((s) => s !== side));
            if (index === '0' && other === '/') slash = true;
            if (index === '1' && other === '/') doubleSlash = true;
          }
        }
        return undefined;
      }
      if (node.type === 'BinaryExpression' && node.operator === 'in' && want.has('allowlist') && refers(node.left as Node)) {
        cleared = true;
        return undefined;
      }
      if (!isCallNode(node)) return undefined;
      const callee = unwrap(node.callee as Node);
      const args = node.arguments as Node[];
      const name = calleeName(callee) ?? '';
      if (helper && helper(name) && args.some((a) => refers(a))) {
        cleared = true;
        return undefined;
      }
      if (!callee || !isMemberNode(callee)) {
        if (want.has('regex') && /^(isUUID|isUuid|isInt|isNumeric|isAlphanumeric|isSlug|isMongoId|isHexadecimal)$/.test(name) && args.some((a) => refers(a))) cleared = true;
        return undefined;
      }
      const recv = unwrap(callee.object as Node);
      const method = propertyName(callee) ?? '';
      const arg0 = args[0];
      // Host checks on a parsed URL: url.hostname.endsWith('.example.com'), ALLOWED.includes(url.host)
      if (want.has('host') || want.has('origin')) {
        if (recv && isMemberNode(recv) && /^(hostname|host|origin)$/.test(propertyName(recv) ?? '') && refers(recv.object as Node) && /^(endsWith|startsWith|includes|match|localeCompare)$/.test(method)) cleared = true;
        if (/^(includes|has|indexOf|some|find|test)$/.test(method) && args.some((a) => {
          const u = unwrap(a);
          return !!u && isMemberNode(u) && /^(hostname|host|origin)$/.test(propertyName(u) ?? '') && refers(u.object as Node);
        })) cleared = true;
        if (want.has('host') && method === 'startsWith' && refers(recv) && arg0) {
          const text = stringValue(arg0);
          if (text === null ? unwrap(arg0)?.type !== 'TemplateLiteral' : /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\//i.test(text)) cleared = true;
        }
      }
      if (want.has('allowlist')) {
        if (/^(includes|has|indexOf|hasOwnProperty)$/.test(method) && arg0 && refers(arg0) && !refers(recv)) cleared = true;
        if (method === 'hasOwn' && memberPath(recv) === 'Object' && args[1] && refers(args[1])) cleared = true;
      }
      if (want.has('regex')) {
        if (method === 'test' && arg0 && refers(arg0) && (recv?.type !== 'RegExpLiteral' || anchored(recv.pattern))) cleared = true;
        if (method === 'match' && refers(recv)) {
          const re = unwrap(arg0);
          if (re?.type === 'RegExpLiteral' && anchored(re.pattern)) cleared = true;
        }
      }
      if (want.has('path-prefix') && method === 'startsWith' && refers(recv) && isResolvedPath(ctx, recv, declared, 0)) cleared = true;
      if (want.has('path-prefix') && method === 'startsWith' && recv && isRelativeCall(ctx, recv, declared)) cleared = true;
      // Rejecting '..' or any path separator keeps the value a single file name.
      if (want.has('dotdot') && /^(includes|indexOf)$/.test(method) && refers(recv) && /\.\.|^[/\\]$/.test(stringValue(arg0) ?? '')) cleared = true;
      if (want.has('dotdot') && method === 'test' && arg0 && refers(arg0) && recv?.type === 'RegExpLiteral' && /\\\.\\\./.test(recv.pattern)) cleared = true;
      if (want.has('relative') && refers(recv)) {
        const text = stringValue(arg0);
        if (method === 'startsWith' && text === '/') slash = true;
        if ((method === 'startsWith' || method === 'includes') && (text === '//' || text === '/\\' || text === '\\')) doubleSlash = true;
      }
      if (want.has('relative') && method === 'test' && arg0 && refers(arg0) && recv?.type === 'RegExpLiteral') {
        if (/^\^(\\\/|\/)/.test(recv.pattern)) {
          slash = true;
          if (/\(\?!|\[\^/.test(recv.pattern)) doubleSlash = true;
        }
      }
      return undefined;
    },
  });
  if (cleared) return { cleared: true };
  if (slash && doubleSlash) return { cleared: true };
  return slash ? { cleared: false, slashOnly: true } : { cleared: false };
}

function anchored(pattern: string): boolean {
  return pattern.startsWith('^') && pattern.endsWith('$') && !/\.\*|\.\+/.test(pattern);
}

function declarationsBefore(scope: Node, before: number): Declared[] {
  const out: Declared[] = [];
  walk(scope, {
    enter(node) {
      if ((node.start ?? 0) >= before) return 'skip';
      if (node.type === 'VariableDeclarator' && node.init) {
        const names: string[] = [];
        collectPatternNames(node.id as Node, names);
        out.push({ names, init: node.init as Node });
      }
      return undefined;
    },
  });
  return out;
}

function collectPatternNames(pattern: Node, out: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const p of pattern.properties) collectPatternNames((p.type === 'RestElement' ? p.argument : p.value) as Node, out);
      break;
    case 'ArrayPattern':
      for (const e of pattern.elements) if (e) collectPatternNames(e as Node, out);
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left as Node, out);
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument as Node, out);
      break;
    default:
      break;
  }
}

/** Key of a method call with literal arguments, such as form.get('url'), so that reads of different fields stay apart. */
function callKey(node: Node): string | null {
  const n = unwrap(node);
  if (!n || !isCallNode(n) || !isMemberNode(n.callee)) return null;
  const callee = memberPath(n.callee as Node);
  if (!callee) return null;
  const args = (n.arguments as Node[]).map((a) => stringValue(a));
  if (args.length === 0 || args.some((a) => a === null)) return null;
  return `${callee}(${args.map((a) => JSON.stringify(a)).join(',')})`;
}

/**
 * The values an expression reads: variables, member paths, and keyed method
 * calls. The objects they are read from (`form` in form.get('url'), `req` in
 * req.query.url) are containers, not values, and are left out.
 */
function valueKeys(expr: Node, keep: (node: Node) => boolean): { names: string[]; paths: string[] } {
  const names: string[] = [];
  const paths: string[] = [];
  const visit = (node: Node | null | undefined, depth: number): void => {
    const n = unwrap(node);
    if (!n || depth > 30 || isFunctionNode(n)) return;
    switch (n.type) {
      case 'Identifier':
        if (keep(n)) names.push(n.name);
        return;
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const path = memberPath(n);
        if (path) {
          if (keep(n)) paths.push(path);
        } else {
          visit(n.object as Node, depth + 1);
        }
        if (n.computed) visit(n.property as Node, depth + 1);
        return;
      }
      case 'CallExpression':
      case 'OptionalCallExpression': {
        const key = callKey(n);
        if (key) {
          if (keep(n)) paths.push(key);
          return;
        }
        if (isMemberNode(n.callee)) visit(n.callee.object as Node, depth + 1);
        for (const a of n.arguments) visit(a as Node, depth + 1);
        return;
      }
      case 'NewExpression':
        for (const a of n.arguments) visit(a as Node, depth + 1);
        return;
      case 'TemplateLiteral':
        for (const e of n.expressions) visit(e as Node, depth + 1);
        return;
      case 'TaggedTemplateExpression':
        for (const e of n.quasi.expressions) visit(e as Node, depth + 1);
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        visit(n.left as Node, depth + 1);
        visit(n.right, depth + 1);
        return;
      case 'ConditionalExpression':
        visit(n.consequent, depth + 1);
        visit(n.alternate, depth + 1);
        return;
      case 'UnaryExpression':
      case 'SpreadElement':
        visit(n.argument, depth + 1);
        return;
      case 'ArrayExpression':
        for (const e of n.elements) visit(e as Node | null, depth + 1);
        return;
      case 'ObjectExpression':
        for (const p of n.properties) visit(p.type === 'ObjectProperty' ? (p.value as Node) : p.type === 'SpreadElement' ? p.argument : null, depth + 1);
        return;
      case 'SequenceExpression':
        visit(n.expressions[n.expressions.length - 1] as Node, depth + 1);
        return;
      case 'AssignmentExpression':
        visit(n.right, depth + 1);
        return;
      default:
        return;
    }
  };
  visit(expr, 0);
  return { names, paths };
}

function familyOf(ctx: JsContext, values: Node[], declared: Declared[]): Family {
  const family: Family = { names: new Set(), paths: new Set() };
  const tainted = (node: Node) => ctx.taint.taintsOf(node).length > 0;
  const addTainted = (expr: Node) => {
    const keys = valueKeys(expr, tainted);
    for (const n of keys.names) family.names.add(n);
    for (const p of keys.paths) family.paths.add(p);
  };
  for (const v of values) addTainted(v);
  for (let round = 0; round < 5; round++) {
    const before = family.names.size + family.paths.size;
    for (const d of declared) {
      if (d.names.some((n) => family.names.has(n))) addTainted(d.init);
      const refs = valueKeys(d.init, () => true);
      if (refs.names.some((n) => family.names.has(n)) || refs.paths.some((p) => family.paths.has(p))) for (const n of d.names) family.names.add(n);
    }
    if (family.names.size + family.paths.size === before) break;
  }
  return family;
}

function refersTo(expr: Node | null | undefined, family: Family): boolean {
  const n = unwrap(expr);
  if (!n) return false;
  if (n.type === 'Identifier') return family.names.has(n.name);
  if (isMemberNode(n)) {
    const path = memberPath(n);
    if (path && family.paths.has(path)) return true;
    return refersTo(n.object as Node, family);
  }
  if (isCallNode(n)) {
    const key = callKey(n);
    if (key && family.paths.has(key)) return true;
    if (isMemberNode(n.callee)) return refersTo(n.callee.object as Node, family);
    return (n.arguments as Node[]).some((a) => refersTo(a, family));
  }
  if (n.type === 'NewExpression') return (n.arguments as Node[]).some((a) => refersTo(a, family));
  if (n.type === 'LogicalExpression') return refersTo(n.left, family) || refersTo(n.right, family);
  return false;
}

const RESOLVERS = /^(path#(resolve|join|normalize)|path\.(resolve|join|normalize)|fs#(realpath|realpathSync)|posix\.(resolve|join|normalize))$/;

function isResolvedPath(ctx: JsContext, node: Node | null, declared: Declared[], depth: number): boolean {
  const n = unwrap(node);
  if (!n || depth > 3) return false;
  if (isCallNode(n)) return RESOLVERS.test(ctx.imports.canonical(n.callee as Node) ?? '');
  if (n.type === 'Identifier') {
    const d = declared.find((x) => x.names.includes(n.name));
    return d ? isResolvedPath(ctx, d.init, declared, depth + 1) : false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Visitors

/**
 * Visitors for every node type that can be a sink, plus the loop hook that
 * binds for-of and for-in variables in the taint tracker (the engine only
 * reports declarations and assignments to it).
 */
export function sinkVisitors(ctx: JsContext, check: (node: Node) => void): Record<string, (node: any) => void> {
  const loop = (node: Node) => ctx.taint.enterLoop(node);
  return {
    ForOfStatement: loop,
    ForInStatement: loop,
    CallExpression: check,
    OptionalCallExpression: check,
    NewExpression: check,
    ImportExpression: check,
    AssignmentExpression: check,
    JSXAttribute: check,
    ObjectProperty: check,
  };
}

/** `path.relative(root, full)` (directly or through a variable), whose result is checked with startsWith('..'). */
function isRelativeCall(ctx: JsContext, node: Node, declared: Declared[]): boolean {
  const n = unwrap(node);
  if (!n) return false;
  const check = (x: Node | null) => {
    const u = unwrap(x);
    return !!u && isCallNode(u) && /^(path#relative|path\.relative|posix\.relative)$/.test(ctx.imports.canonical(u.callee as Node) ?? '');
  };
  if (check(n)) return true;
  if (n.type === 'Identifier') {
    const d = declared.find((x) => x.names.includes(n.name));
    return d ? check(d.init) : false;
  }
  return false;
}
