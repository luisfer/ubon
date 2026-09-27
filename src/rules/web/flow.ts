import type { Node } from '@babel/types';
import type { Level, TraceStep } from '../../core/types.ts';
import {
  OPAQUE,
  OPTIONAL,
  type Taint,
  bindingNames,
  calleeName,
  enclosingFunction,
  hostFixed,
  isCallNode,
  isMemberNode,
  keyName,
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
import type { FileInfo, JsContext, JsVisitors } from '../types.ts';
import { type Sink, type SinkCategory, declarationInit, sinksOf } from './sinks.ts';

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

export type GuardKind = 'host' | 'allowlist' | 'regex' | 'path-prefix' | 'dotdot' | 'relative' | 'origin' | 'private';

export interface GuardResult {
  cleared: boolean;
  /** Redirect targets checked for a leading '/' but not for '//'. */
  slashOnly?: boolean;
  /**
   * The URL's host is checked against private and loopback addresses only:
   * 'resolved' after a DNS lookup (or by a helper that takes the URL or host),
   * 'unresolved' when an address check runs on the host name as written.
   */
  privateCheck?: 'resolved' | 'unresolved';
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
            // hostname === 'localhost' rejects one host; it does not limit where the request can go.
            const denied = want.has('host') && isPrivateHostText(stringValue(sides.find((s) => s !== side)));
            if (!denied && (want.has('host') || want.has('origin'))) cleared = true;
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
      if (node.type === 'BinaryExpression' && node.operator === 'in' && want.has('allowlist') && refers(node.left as Node) && !isDenyList(node.right, false)) {
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
        const hosts = want.has('host');
        if (recv && isMemberNode(recv) && /^(hostname|host|origin)$/.test(propertyName(recv) ?? '') && refers(recv.object as Node) && /^(endsWith|startsWith|includes|match|localeCompare)$/.test(method)) {
          // hostname.startsWith('127.') or .endsWith('.local') rejects some hosts and lets the rest through.
          if (!(hosts && (isPrivateHostText(stringValue(arg0)) || isDenyList(arg0, true)))) cleared = true;
        }
        if (/^(includes|has|indexOf|some|find|test)$/.test(method) && !(hosts && isDenyList(recv, true)) && args.some((a) => {
          const u = unwrap(a);
          return !!u && isMemberNode(u) && /^(hostname|host|origin)$/.test(propertyName(u) ?? '') && refers(u.object as Node);
        })) cleared = true;
        if (want.has('host') && method === 'startsWith' && refers(recv) && arg0) {
          const text = stringValue(arg0);
          if (text === null ? unwrap(arg0)?.type !== 'TemplateLiteral' : /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\//i.test(text)) cleared = true;
        }
      }
      if (want.has('allowlist')) {
        if (/^(includes|has|indexOf|hasOwnProperty)$/.test(method) && arg0 && refers(arg0) && !refers(recv) && !isDenyList(recv, want.has('host'))) cleared = true;
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
  const result: GuardResult = { cleared: false };
  if (slash) result.slashOnly = true;
  if (want.has('private')) {
    const check = privateCheck(ctx, scope, sinkStart, refers);
    if (check) result.privateCheck = check;
  }
  return result;
}

/**
 * Host names and address prefixes of the machine itself and of private
 * networks ('localhost', '127.', '10.', '.internal', '169.254.169.254').
 * Comparing a host with them rejects those hosts and lets every other through.
 */
export function isPrivateHostText(text: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (/^(localhost|0\.0\.0\.0|0\.|::1?|metadata|metadata\.google\.internal)$/.test(t)) return true;
  if (/^(127|10)\.[\d.]*$/.test(t) || /^192\.168\.?[\d.]*$/.test(t) || /^169\.254\.?[\d.]*$/.test(t) || /^172\.((1[6-9]|2\d|3[01])\.?[\d.]*)?$/.test(t)) return true;
  if (/^(fc|fd|fe80)(:.*)?$/.test(t)) return true;
  return /(^|\.)(localhost|local|internal)$/.test(t);
}

/**
 * A collection or pattern of values to reject (BLOCKED_HOSTS, a denylist,
 * ['localhost', '127.0.0.1'], /^127\./): finding the value in it is not an
 * allowlist check. With `hosts`, lists named for private or internal hosts
 * count too.
 */
function isDenyList(node: Node | null | undefined, hosts: boolean): boolean {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'RegExpLiteral') return hosts && /localhost|127|169\\?\.254|192\\?\.168|\\?\.local|\\?\.internal/.test(n.pattern);
  const path = memberPath(n);
  const last = path?.split('.').pop() ?? '';
  if (/(block|deny|denied|forbid|disallow|banned|reject|blacklist)/i.test(last)) return true;
  if (hosts && /(private|internal|loopback|reserved)/i.test(last)) return true;
  const list = n.type === 'NewExpression' ? unwrap(n.arguments[0] as Node) : n;
  if (list?.type === 'ArrayExpression' && list.elements.length > 0) return list.elements.every((e) => isPrivateHostText(stringValue(e as Node)));
  return false;
}

/** DNS resolution of a host name: dns.lookup, dns.promises.resolve4, lookup from dns/promises. */
const DNS_CALL = /^(dns(\/promises)?#(promises\.)?(lookup|resolve|resolve4|resolve6|resolveAny)|lookup|resolve4|resolve6|resolveAny|dnsLookup|lookupHost(name)?|resolveHost(name)?)$/;

/** Checks for private, loopback, reserved, or public addresses: isPrivateIp, ip.isPrivate, isLoopback, isPublicUrl. */
const ADDRESS_CHECK = /^is(Private|Internal|Loopback|Reserved|Local|LinkLocal|Bogon|Special|Blocked|Forbidden|Disallowed|Unsafe|Restricted|Public|External|Global|Routable)([A-Z0-9_]\w*)?$/;

/**
 * A check of the URL's host against private and loopback addresses, before
 * the sink: 'resolved' when the checked address comes from a DNS lookup of
 * the host (or the check is a helper that takes the URL or host), 'unresolved'
 * when an address check runs on the host name as written.
 *
 *   const { address } = await lookup(url.hostname);
 *   if (isPrivateIp(address)) return;
 */
function privateCheck(ctx: JsContext, scope: Node, sinkStart: number, refers: (x: Node | null | undefined) => boolean): 'resolved' | 'unresolved' | undefined {
  // Names that hold DNS answers for the host: address, addresses, records.
  const answers = new Set<string>();
  const fromDns = (x: Node | null | undefined): boolean => readsName(x, answers);
  const resolves = (x: Node | null | undefined): boolean => {
    let hit = false;
    if (!x) return false;
    walk(x, {
      enter(n) {
        if (hit) return 'skip';
        if (isCallNode(n) && DNS_CALL.test(ctx.imports.canonical(n.callee as Node) ?? '') && (n.arguments as Node[]).some((a) => refers(a))) hit = true;
        return undefined;
      },
    });
    return hit;
  };
  let resolved = false;
  let unresolved = false;
  walk(scope, {
    enter(node) {
      if (resolved) return 'skip';
      if ((node.start ?? 0) >= sinkStart) return 'skip';
      if (node.type === 'VariableDeclarator' && node.init && (resolves(node.init as Node) || fromDns(node.init as Node))) {
        for (const name of bindingNames(node.id as Node)) answers.add(name);
        return undefined;
      }
      if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && (resolves(node.right) || fromDns(node.right))) {
        answers.add(node.left.name);
        return undefined;
      }
      // for (const { address } of addresses)
      if (node.type === 'ForOfStatement' && fromDns(node.right)) {
        const left = node.left.type === 'VariableDeclaration' ? node.left.declarations[0]?.id : node.left;
        for (const name of bindingNames(left as Node)) answers.add(name);
        return undefined;
      }
      if (!isCallNode(node)) return undefined;
      const callee = unwrap(node.callee as Node);
      if (!callee) return undefined;
      const args = node.arguments as Node[];
      // addresses.some(isPrivateIp), addresses.some((a) => isPrivateIp(a.address))
      if (isMemberNode(callee) && /^(some|every|find|findIndex|filter|forEach|map)$/.test(propertyName(callee) ?? '') && fromDns(callee.object as Node)) {
        const fn = unwrap(args[0]);
        if (fn?.type === 'Identifier' && ADDRESS_CHECK.test(fn.name)) resolved = true;
        else if (fn && isFunctionNode(fn)) for (const p of (fn as { params: Node[] }).params) for (const name of bindingNames(p)) answers.add(name);
        return undefined;
      }
      const name = calleeName(callee) ?? '';
      const isCheck = ADDRESS_CHECK.test(name) || (name === 'range' && isMemberNode(callee)) || (name === 'check' && isMemberNode(callee) && /block/i.test(memberPath(callee.object as Node) ?? ''));
      if (!isCheck) return undefined;
      // The checked value can sit in the receiver chain: ipaddr.parse(address).range()
      const inputs = [...args, ...receiverArguments(callee)];
      if (inputs.some((a) => fromDns(a))) resolved = true;
      else if (inputs.some((a) => refers(a))) {
        // isPublicUrl(url), isPrivateHost(host): a helper that can resolve the name itself.
        if (/(url|uri|host|domain|origin|endpoint)/i.test(name)) resolved = true;
        else unresolved = true;
      }
      return undefined;
    },
  });
  return resolved ? 'resolved' : unresolved ? 'unresolved' : undefined;
}

/** Arguments of the calls a member callee is chained on: `address` in ipaddr.parse(address).range(). */
function receiverArguments(callee: Node): Node[] {
  const out: Node[] = [];
  let n: Node | null = isMemberNode(callee) ? unwrap(callee.object as Node) : null;
  for (let depth = 0; n && depth < 10; depth++) {
    if (isCallNode(n)) {
      out.push(...(n.arguments as Node[]));
      n = unwrap(n.callee as Node);
    } else if (isMemberNode(n)) {
      n = unwrap(n.object as Node);
    } else {
      break;
    }
  }
  return out;
}

/** True when an expression reads one of the names, as a value or as the object of a property read (not as a property name). */
function readsName(expr: Node | null | undefined, names: ReadonlySet<string>): boolean {
  if (!expr || names.size === 0) return false;
  let hit = false;
  walk(expr, {
    enter(node, parents) {
      if (hit) return 'skip';
      if (node.type !== 'Identifier' || !names.has(node.name)) return undefined;
      const parent = parents[parents.length - 1];
      if (parent && isMemberNode(parent) && parent.property === node && !parent.computed) return undefined;
      if (parent && parent.type === 'ObjectProperty' && parent.key === node && !parent.computed && !parent.shorthand) return undefined;
      hit = true;
      return undefined;
    },
  });
  return hit;
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
      // `let parsed; try { parsed = new URL(url) } catch {}` links parsed to url like a declaration.
      if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') out.push({ names: [node.left.name], init: node.right });
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
// Lookups: the value was looked up before the sink, and the code goes on only on a match

export interface LookupCheck {
  /** The lookup as written: retrieveCodeSnippet(), CHALLENGES[key]. */
  name: string;
  line: number;
}

interface LookupTest {
  /** 'found' when the test is true only if the lookup matched, 'missing' when it is true if nothing matched. */
  kind: 'found' | 'missing';
  check: LookupCheck;
}

interface Source {
  name: string;
  /** The whole value the name holds (`x = init`). */
  init?: Node;
  /** The property a destructured name reads (`req.body.key` for `const { key } = req.body`). */
  path?: string;
}

/**
 * A lookup the sink's value went through, earlier in the same function: the
 * value is an argument of a call (or the key of a property read) whose result
 * is tested, and the sink runs only when the lookup found something. The test
 * either leaves when nothing was found (return, throw, next(), or a response)
 * or holds the sink in the branch for a match:
 *
 *   const snippet = await retrieveCodeSnippet(key);
 *   if (snippet == null) return res.status(404).end();
 *   await readFile(`codefixes/${key}.yml`);
 *
 * Ubon cannot read which values the lookup accepts, so a rule lowers its level
 * instead of clearing the finding. File system and path calls are not
 * lookups: a path outside the directory can exist too.
 */
export function findLookup(ctx: JsContext, sink: Sink, live: LiveTaint[]): LookupCheck | undefined {
  const scope: Node = enclosingFunction(ctx.parents) ?? ctx.program.program;
  const sinkStart = sink.node.start ?? Number.MAX_SAFE_INTEGER;
  const sinkEnd = sink.node.end ?? sinkStart;
  const value = valueSources(ctx, live.map((l) => l.value), scope, sinkStart);
  if (value.names.size === 0 && value.paths.size === 0) return undefined;
  const results: { names: string[]; check: LookupCheck }[] = [];
  const resultOf = (x: Node): LookupCheck | null => {
    const u = unwrap(x);
    if (!u) return null;
    const root = rootName(u);
    const bound = root === null ? undefined : results.find((r) => r.names.includes(root));
    return bound ? bound.check : lookupExpression(ctx, u, value);
  };
  const holdsSink = (branch: Node | null | undefined): boolean => !!branch && (branch.start ?? 0) <= sinkStart && sinkEnd <= (branch.end ?? 0);
  let found: LookupCheck | undefined;
  walk(scope, {
    enter(node, parents) {
      if (found) return 'skip';
      if ((node.start ?? 0) >= sinkStart) return 'skip';
      if (node !== scope && isFunctionNode(node)) return 'skip';
      // const snippet = await retrieveCodeSnippet(key);  snippet = lookup(key);
      const target = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier' ? node.left : null;
      if (target) {
        const init = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentExpression' ? node.right : null;
        const check = init ? lookupExpression(ctx, init as Node, value) : null;
        const names = bindingNames(target as Node);
        // A name the sink reads holds the value itself (a cleaned copy), not the result of a lookup.
        if (check && names.length > 0 && !names.some((n) => value.names.has(n))) results.push({ names, check });
        return undefined;
      }
      let test: Node | null = null;
      let match: Node | null = null;
      let miss: Node | null = null;
      if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
        test = node.test;
        match = node.consequent;
        miss = node.alternate ?? null;
      } else if (node.type === 'LogicalExpression' && node.operator === '&&') {
        test = node.left;
        match = node.right;
      }
      if (!test) return undefined;
      const t = lookupTest(test, resultOf);
      if (!t) return undefined;
      if (t.kind === 'found' && holdsSink(match)) found = t.check;
      else if (t.kind === 'missing' && holdsSink(miss)) found = t.check;
      else if (t.kind === 'missing' && node.type === 'IfStatement' && (node.end ?? 0) <= sinkStart && leaves(node.consequent) && precedes(node, parents, scope, sinkStart, sinkEnd)) found = t.check;
      return undefined;
    },
  });
  return found;
}

/**
 * The names and property paths a sink value is built from, followed back
 * through declarations and assignments earlier in the function: readFile(file)
 * with `const file = path.join(dir, name)` and `const { name } = req.params`
 * gives file, name, and req.params.name. A destructured name stands for its
 * own property, so the other fields of the same object stay apart, and
 * request objects (req, request) are not values.
 */
function valueSources(ctx: JsContext, values: Node[], scope: Node, before: number): Family {
  const family: Family = { names: new Set(), paths: new Set() };
  const keep = (node: Node) => ctx.taint.taintsOf(node).length > 0 && !ctx.taint.isRequestObject(node);
  const add = (expr: Node) => {
    const keys = valueKeys(expr, keep);
    for (const n of keys.names) family.names.add(n);
    for (const p of keys.paths) family.paths.add(p);
  };
  for (const v of values) add(v);
  const sources: Source[] = [];
  walk(scope, {
    enter(node) {
      if ((node.start ?? 0) >= before) return 'skip';
      if (node !== scope && isFunctionNode(node)) return 'skip';
      if (node.type === 'VariableDeclarator' && node.init) bindSources(node.id as Node, node.init as Node, undefined, sources);
      else if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') sources.push({ name: node.left.name, init: node.right });
      return undefined;
    },
  });
  for (let round = 0; round < 5; round++) {
    const size = family.names.size + family.paths.size;
    for (const s of sources) {
      if (!family.names.has(s.name)) continue;
      if (s.path) family.paths.add(s.path);
      else if (s.init) add(s.init);
    }
    if (family.names.size + family.paths.size === size) break;
  }
  return family;
}

/** `x = init` binds x to init; `{ a, b: c } = obj` binds a and c to obj.a and obj.b; `base` null means the property is unknown. */
function bindSources(target: Node, init: Node, base: string | null | undefined, out: Source[]): void {
  if (target.type === 'Identifier') {
    out.push(base === undefined ? { name: target.name, init } : base === null ? { name: target.name } : { name: target.name, path: base });
    return;
  }
  if (target.type === 'AssignmentPattern') {
    bindSources(target.left as Node, init, base, out);
    return;
  }
  const from = base === undefined ? memberPath(init) : base;
  if (target.type === 'ObjectPattern') {
    for (const p of target.properties) {
      if (p.type === 'RestElement') continue;
      const key = keyName(p);
      bindSources(p.value as Node, init, from && key ? `${from}.${key}` : null, out);
    }
    return;
  }
  if (target.type === 'ArrayPattern') for (const e of target.elements) if (e) bindSources(e as Node, init, null, out);
}

function rootName(node: Node): string | null {
  let n: Node | null = node;
  for (let depth = 0; n && isMemberNode(n) && depth < 20; depth++) n = unwrap(n.object as Node);
  return n?.type === 'Identifier' ? n.name : null;
}

/**
 * The lookup an expression makes with the value, or null: a call that takes
 * the value as an argument, anywhere in a chain such as lookup(key).catch(...)
 * or db.select().where(eq(t.name, key)), or a property read keyed by it
 * (CHALLENGES[key]) from an object that is not request data.
 */
function lookupExpression(ctx: JsContext, expr: Node, value: Family): LookupCheck | null {
  let n: Node | null = unwrap(expr);
  for (let depth = 0; n && depth < 20; depth++) {
    if (isCallNode(n)) {
      const call = n as Node & { callee: Node; arguments: Node[] };
      if (call.arguments.some((a) => carriesValue(ctx, a, value, 0))) return notLookup(ctx, call) ? null : { name: lookupName(ctx, call), line: lineOf(call) };
      const callee = unwrap(call.callee);
      n = callee && isMemberNode(callee) ? unwrap(callee.object as Node) : null;
    } else if (isMemberNode(n)) {
      const object = n.object as Node;
      if (n.computed && carriesValue(ctx, n.property as Node, value, 0) && ctx.taint.taintsOf(object).length === 0 && !ctx.taint.isRequestObject(object)) {
        return { name: shorten(snippet(ctx.text, n), 40), line: lineOf(n) };
      }
      n = unwrap(object);
    } else {
      return null;
    }
  }
  return null;
}

function lookupName(ctx: JsContext, call: Node & { callee: Node }): string {
  const path = memberPath(call.callee);
  return `${shorten(path ?? snippet(ctx.text, call.callee), 40)}()`;
}

/** Calls that are not lookups (by module, by global, by name). */
const NOT_LOOKUP = /^((fs|fs-extra|graceful-fs|path|url|util|os|stream|zlib|crypto|buffer|querystring|dns|net)#|(JSON|Object|Array|Math|Buffer|Promise|Reflect|Date|URL|URLSearchParams|Bun|Deno|console|process|path|fs|Number|String)\.)|^(String|Number|Boolean|BigInt|parseInt|parseFloat|decodeURI|decodeURIComponent|encodeURI|encodeURIComponent|escape|unescape|atob|btoa|isNaN|isFinite|structuredClone|require|fetch)$/;

/** Existence checks by name: a path outside the directory can exist too. */
const EXISTENCE = /exist|^(l?stat|access|isFile|isDirectory|isDir|isReadable|isWritable)(Sync)?$/i;

function notLookup(ctx: JsContext, call: Node & { callee: Node }): boolean {
  const callee = unwrap(call.callee);
  if (!callee) return true;
  if (NOT_LOOKUP.test(ctx.imports.canonical(callee) ?? '')) return true;
  if (EXISTENCE.test(calleeName(callee) ?? '')) return true;
  // Methods of the value itself or of request data: key.split('/'), req.get(name), searchParams.get(name)
  if (isMemberNode(callee)) {
    const recv = callee.object as Node;
    if (ctx.taint.taintsOf(recv).length > 0 || ctx.taint.isRequestObject(recv)) return true;
  }
  // Network requests and other sinks look nothing up; a database query can.
  return sinksOf(ctx, call).some((s) => s.category !== 'sql');
}

/** True when an argument passes the whole value on: the value itself, or the value inside a string, object, array, or a call that keeps it whole. */
function carriesValue(ctx: JsContext, node: Node | null | undefined, value: Family, depth: number): boolean {
  const n = unwrap(node);
  if (!n || depth > 8 || ctx.taint.isRequestObject(n)) return false;
  if (n.type === 'Identifier') return value.names.has(n.name);
  if (isMemberNode(n)) {
    const path = memberPath(n);
    return path !== null && value.paths.has(path);
  }
  const next = (x: Node | null | undefined) => carriesValue(ctx, x, value, depth + 1);
  switch (n.type) {
    case 'TemplateLiteral':
      return n.expressions.some((e) => next(e as Node));
    case 'BinaryExpression':
      return n.operator === '+' && (next(n.left as Node) || next(n.right));
    case 'LogicalExpression':
      return next(n.left) || next(n.right);
    case 'ObjectExpression':
      return n.properties.some((p) => p.type === 'ObjectProperty' && next(p.value as Node));
    case 'ArrayExpression':
      return n.elements.some((e) => !!e && next(e as Node));
    case 'CallExpression':
    case 'OptionalCallExpression': {
      const callee = unwrap(n.callee as Node);
      // key.trim(), String(key): the same value in another form.
      if (callee && isMemberNode(callee) && /^(trim|trimStart|trimEnd|toLowerCase|toUpperCase|toString|normalize)$/.test(propertyName(callee) ?? '')) return next(callee.object as Node);
      if (callee?.type === 'Identifier' && /^(String|decodeURI|decodeURIComponent)$/.test(callee.name)) return next(n.arguments[0] as Node);
      // eq(files.name, key) inside where(...), but not path.extname(key) or key.split('/')
      if (notLookup(ctx, n as Node & { callee: Node })) return false;
      return (n.arguments as Node[]).some((a) => next(a));
    }
    default:
      return false;
  }
}

function lookupTest(test: Node | null | undefined, resultOf: (x: Node) => LookupCheck | null): LookupTest | null {
  const t = unwrap(test);
  if (!t) return null;
  if (t.type === 'UnaryExpression' && t.operator === '!') {
    const inner = lookupTest(t.argument, resultOf);
    return inner && { kind: inner.kind === 'found' ? 'missing' : 'found', check: inner.check };
  }
  if (t.type === 'LogicalExpression') {
    // `!a || !b` is true when either lookup failed; `a && b` only when both matched.
    const want = t.operator === '||' ? 'missing' : t.operator === '&&' ? 'found' : null;
    if (!want) return null;
    for (const side of [t.left, t.right]) {
      const k = lookupTest(side, resultOf);
      if (k?.kind === want) return k;
    }
    return null;
  }
  if (t.type === 'BinaryExpression') return comparedLookup(t.operator, t.left as Node, t.right, resultOf);
  const check = resultOf(t);
  return check ? { kind: 'found', check } : null;
}

/** x == null, typeof x === 'undefined', x.length === 0, x.length > 0 */
function comparedLookup(operator: string, leftNode: Node, rightNode: Node, resultOf: (x: Node) => LookupCheck | null): LookupTest | null {
  const left = unwrap(leftNode);
  const right = unwrap(rightNode);
  if (!left || !right) return null;
  const equal = operator === '==' || operator === '===';
  const unequal = operator === '!=' || operator === '!==';
  for (const [a, b] of [
    [left, right],
    [right, left],
  ] as const) {
    const nullish = b.type === 'NullLiteral' || (b.type === 'Identifier' && b.name === 'undefined') || (b.type === 'UnaryExpression' && b.operator === 'void');
    const operand = nullish ? a : a.type === 'UnaryExpression' && a.operator === 'typeof' && stringValue(b) === 'undefined' ? unwrap(a.argument) : null;
    if (!operand || !(equal || unequal)) continue;
    const check = resultOf(operand);
    return check ? { kind: equal ? 'missing' : 'found', check } : null;
  }
  const flipped: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
  let member = left;
  let number = right;
  let op = operator;
  if (isMemberNode(right) && left.type === 'NumericLiteral') {
    member = right;
    number = left;
    op = flipped[operator] ?? operator;
  }
  if (!isMemberNode(member) || propertyName(member) !== 'length' || number.type !== 'NumericLiteral') return null;
  const check = resultOf(member.object as Node);
  if (!check) return null;
  const v = number.value;
  if (((op === '===' || op === '==') && v === 0) || (op === '<' && v === 1) || (op === '<=' && v === 0)) return { kind: 'missing', check };
  if (((op === '!==' || op === '!=') && v === 0) || (op === '>' && v === 0) || (op === '>=' && v === 1)) return { kind: 'found', check };
  return null;
}

/** Calls that end the handler: next(), notFound(), redirect(), SvelteKit's error(). */
const EXIT_FUNCTION = /^(next|notFound|redirect|permanentRedirect|forbidden|unauthorized|error)$/;
/** Methods that send a response: res.status(404).json(), reply.send(), ctx.throw(). */
const RESPONSE_METHOD = /^(send|json|jsonp|end|sendStatus|sendFile|download|redirect|render|throw|notFound|callNotFound|text|html|body|writeHead)$/;
const RESPONSE_OBJECT = /^(res|resp|response|reply|ctx|context|c|h)$/;

/** True when a branch always leaves: return, throw, break, continue, next(), notFound(), or a response such as res.status(404).json(). */
function leaves(branch: Node | null | undefined): boolean {
  if (!branch) return false;
  const statements = branch.type === 'BlockStatement' ? branch.body : [branch];
  return statements.some((s: Node) => {
    if (s.type === 'ReturnStatement' || s.type === 'ThrowStatement' || s.type === 'BreakStatement' || s.type === 'ContinueStatement') return true;
    if (s.type === 'BlockStatement') return leaves(s);
    return s.type === 'ExpressionStatement' && isExitCall(s.expression);
  });
}

function isExitCall(expr: Node): boolean {
  const n = unwrap(expr);
  if (!n || !isCallNode(n)) return false;
  const callee = unwrap(n.callee as Node);
  if (callee?.type === 'Identifier') return EXIT_FUNCTION.test(callee.name);
  if (!callee || !isMemberNode(callee) || !RESPONSE_METHOD.test(propertyName(callee) ?? '')) return false;
  // res.status(404).json(...): follow the chain down to the response object.
  let base: Node | null = unwrap(callee.object as Node);
  for (let depth = 0; base && depth < 10; depth++) {
    if (isCallNode(base)) base = unwrap(base.callee as Node);
    else if (isMemberNode(base)) base = unwrap(base.object as Node);
    else break;
  }
  return base?.type === 'Identifier' && RESPONSE_OBJECT.test(base.name);
}

/**
 * True when a statement runs on every path to the sink: each statement around
 * it, up to the function, also holds the sink, or is a plain block, or is a
 * try whose catch leaves.
 */
function precedes(statement: Node, parents: readonly Node[], scope: Node, sinkStart: number, sinkEnd: number): boolean {
  const from = parents.indexOf(scope);
  for (let i = from + 1; i < parents.length; i++) {
    const a = parents[i] as Node;
    if ((a.start ?? 0) <= sinkStart && sinkEnd <= (a.end ?? 0)) continue;
    if (a.type === 'BlockStatement' || a.type === 'LabeledStatement') continue;
    if (a.type === 'TryStatement' && (a.block.start ?? 0) <= (statement.start ?? 0) && (statement.end ?? 0) <= (a.block.end ?? 0) && (!a.handler || leaves(a.handler.body))) continue;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Visitors

/**
 * Visitors for every node type that can be a sink, plus the loop hook that
 * binds for-of and for-in variables in the taint tracker (the engine only
 * reports declarations and assignments to it).
 */
export function sinkVisitors(ctx: JsContext, check: (node: Node) => void): JsVisitors {
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
