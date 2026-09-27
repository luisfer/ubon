import type { ArrayExpression, Node, ObjectExpression } from '@babel/types';
import { boolValue, keyName, memberPath, propertyName, stringValue, unwrap } from '../../lang/js.ts';
import { parseStructured, isRecord } from '../../lang/structured.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import type { JsContext, Rule } from '../types.ts';
import { Bindings, exampleLevel, isCall, lastSegment } from './pattern-ast.ts';

/**
 * Credentialed CORS that trusts every origin: `Access-Control-Allow-Origin: *`
 * together with `Access-Control-Allow-Credentials: true`, or an origin copied
 * from the request (req.headers.origin, `origin: true` in the cors package)
 * while credentials are allowed and nothing checks the origin against a list.
 *
 * Covers header objects, setHeader/headers.set calls in the same function,
 * the cors package (Express, NestJS), @fastify/cors, @koa/cors, Hono cors(),
 * Next.js `headers()` config, vercel.json, netlify.toml, and `_headers`
 * files. A wildcard without credentials is valid for public APIs and is not
 * reported.
 */

type OriginKind = 'wildcard' | 'reflected' | 'other';

const ACAO = /^access-control-allow-origin$/i;
const ACAC = /^access-control-allow-credentials$/i;

const CHECK_METHODS = new Set(['includes', 'has', 'indexOf', 'lastIndexOf', 'test', 'match', 'matchAll', 'exec', 'some', 'find', 'findIndex', 'startsWith', 'endsWith', 'search']);
const CHECK_NAME = /allow|valid|trust|permit|whitelist|allowlist|safelist|isOrigin|originOk|checkOrigin|verifyOrigin|matchOrigin|isSameOrigin|isKnown/i;

function isTrue(node: Node | null | undefined): boolean {
  return boolValue(node) === true;
}

/** Does this expression read the request's Origin header (or another request value)? */
function readsRequestOrigin(node: Node | null | undefined, ctx: JsContext | null, b: Bindings, parents: readonly Node[], depth = 0): boolean {
  const n = unwrap(node);
  if (!n || depth > 4) return false;
  if (n.type === 'LogicalExpression') return readsRequestOrigin(n.left, ctx, b, parents, depth + 1) || readsRequestOrigin(n.right, ctx, b, parents, depth + 1);
  if (n.type === 'ConditionalExpression') return readsRequestOrigin(n.consequent, ctx, b, parents, depth + 1) || readsRequestOrigin(n.alternate, ctx, b, parents, depth + 1);
  if (n.type === 'TemplateLiteral') return n.expressions.some((e) => readsRequestOrigin(e as Node, ctx, b, parents, depth + 1));
  const path = memberPath(n) ?? '';
  if (/(^|\.)headers\.(origin|referer)$/i.test(path)) return true;
  if (isCall(n)) {
    const method = lastSegment(memberPath(n.callee));
    const arg = stringValue(n.arguments[0] as Node)?.toLowerCase();
    if ((method === 'get' || method === 'header' || method === 'getHeader' || method === 'headers') && (arg === 'origin' || arg === 'referer')) return true;
  }
  if (ctx) {
    const t = ctx.taint.taintOf(n);
    if (t?.kind === 'request') return true;
  }
  if (n.type === 'Identifier') {
    const init = b.resolve(n.name, parents);
    if (init) return readsRequestOrigin(init, null, b, parents, depth + 1);
  }
  return false;
}

/** Names that hold the origin in a function: const origin = req.headers.origin. */
function originNames(fn: Node, b: Bindings, parents: readonly Node[]): Set<string> {
  const names = new Set<string>(['origin', 'requestOrigin', 'reqOrigin']);
  walk(fn, {
    enter(node) {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && readsRequestOrigin(node.init as Node, null, b, parents)) names.add(node.id.name);
      if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern') {
        for (const p of node.id.properties) if (p.type === 'ObjectProperty' && keyName(p) === 'origin' && p.value.type === 'Identifier') names.add(p.value.name);
      }
      return undefined;
    },
  });
  return names;
}

function mentionsOrigin(node: Node | null | undefined, names: Set<string>): boolean {
  if (!node) return false;
  let found = false;
  walk(node, {
    enter(n) {
      if (found) return 'skip';
      if (n.type === 'Identifier' && names.has(n.name)) found = true;
      else if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && /(^|\.)(headers\.)?origin$/i.test(memberPath(n) ?? '')) found = true;
      else if (isCall(n) && /^origin$/i.test(stringValue(n.arguments[0] as Node) ?? '')) found = true;
      return undefined;
    },
  });
  return found;
}

/** True when the function compares the origin with something: a list, a regex, a fixed value, or an allow-check helper. */
function hasAllowlistCheck(fn: Node, names: Set<string>): boolean {
  let found = false;
  walk(fn, {
    enter(n) {
      if (found) return 'skip';
      if (isCall(n)) {
        const callee = n.callee as Node;
        const path = memberPath(callee) ?? '';
        const method = lastSegment(path);
        const objectMentions = (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && mentionsOrigin(callee.object as Node, names);
        const argMentions = n.arguments.some((a) => mentionsOrigin(a as Node, names));
        if (CHECK_METHODS.has(method) && (objectMentions || argMentions)) found = true;
        else if (CHECK_NAME.test(method) && argMentions) found = true;
      } else if (n.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(n.operator)) {
        const [a, b] = [n.left as Node, n.right];
        const other = mentionsOrigin(a, names) ? b : mentionsOrigin(b, names) ? a : null;
        if (other) {
          const u = unwrap(other);
          const literal = stringValue(u);
          const nullish = u?.type === 'NullLiteral' || (u?.type === 'Identifier' && u.name === 'undefined');
          if (!nullish && literal !== '' && literal !== '*' && u?.type !== 'UnaryExpression') found = true;
        }
      } else if (n.type === 'SwitchStatement' && mentionsOrigin(n.discriminant, names)) {
        found = n.cases.some((c) => stringValue(c.test as Node) !== null);
      }
      return undefined;
    },
  });
  return found;
}

/** What an origin option or header value allows: '*', the request's own origin, or something else. */
function originKind(value: Node | null | undefined, ctx: JsContext, b: Bindings, parents: readonly Node[], fn: Node | null): OriginKind {
  const v = b.follow(value, parents);
  if (!v) return 'other';
  if (stringValue(v) === '*') return 'wildcard';
  if (readsRequestOrigin(value, ctx, b, parents)) {
    if (fn && hasAllowlistCheck(fn, originNames(fn, b, parents))) return 'other';
    return 'reflected';
  }
  return 'other';
}

/** cors({ origin }) option: '*', true, or a function that allows every origin, with a short description for the message. */
function corsOriginOption(value: Node | null, b: Bindings, parents: readonly Node[], defaultKind: OriginKind): { kind: OriginKind; detail: string } {
  if (!value) return { kind: defaultKind, detail: defaultKind === 'wildcard' ? 'no origin option, which defaults to *' : 'no origin option, which echoes the Origin header by default' };
  const v = b.follow(value, parents);
  if (!v) return { kind: 'other', detail: '' };
  if (stringValue(v) === '*') return { kind: 'wildcard', detail: "origin: '*'" };
  if (boolValue(v) === true) return { kind: 'reflected', detail: 'origin: true echoes the Origin header' };
  const kind = originFunctionKind(v);
  return { kind, detail: kind === 'reflected' ? 'the origin callback accepts every origin' : '' };
}

function originFunctionKind(v: Node): OriginKind {
  if (isFunctionNode(v)) {
    const fnNode = v as Node & { params: Node[]; body: Node };
    const names = new Set<string>();
    const first = fnNode.params[0];
    if (first?.type === 'Identifier') names.add(first.name);
    if (hasAllowlistCheck(fnNode, names)) return 'other';
    // (origin, cb) => cb(null, true), (origin) => origin, (origin, cb) => cb(null, origin)
    let allowsAll = false;
    walk(fnNode.body, {
      enter(n) {
        if (isCall(n)) {
          const arg = unwrap(n.arguments[1] as Node);
          if (n.arguments.length >= 2 && (boolValue(arg) === true || (arg?.type === 'Identifier' && names.has(arg.name)))) allowsAll = true;
        }
        if (n.type === 'ReturnStatement' && (boolValue(n.argument as Node) === true || (unwrap(n.argument as Node)?.type === 'Identifier' && names.has((unwrap(n.argument as Node) as { name: string }).name)))) allowsAll = true;
        return undefined;
      },
    });
    const body = unwrap(fnNode.body);
    if (body && ((body.type === 'Identifier' && names.has(body.name)) || boolValue(body) === true)) allowsAll = true;
    return allowsAll ? 'reflected' : 'other';
  }
  return 'other';
}

/** Message for headers set directly: `subject` sets the header, `credLine` is where credentials are allowed (when on another line). */
function headerMessage(kind: OriginKind, subject: string, credLine?: number): string {
  const cred = credLine ? ` while Access-Control-Allow-Credentials is true (line ${credLine})` : ' together with Access-Control-Allow-Credentials: true';
  return kind === 'wildcard'
    ? `${subject} sets Access-Control-Allow-Origin to *${cred}.`
    : `${subject} copies the request's Origin header into Access-Control-Allow-Origin${cred}, and nothing checks it against an allowlist.`;
}

/** Message for cors middleware options. */
function corsMessage(kind: OriginKind, subject: string, detail: string): string {
  return kind === 'wildcard' ? `${subject} allows every origin (${detail}) with credentials: true.` : `${subject} accepts any request origin (${detail}) with credentials: true.`;
}

const FIX_WILDCARD = 'Allow a fixed list of trusted origins, or drop Access-Control-Allow-Credentials if the API does not use cookies or auth headers.';
const FIX_REFLECTED = 'Check the Origin header against a fixed list of trusted origins before echoing it back.';

interface HeaderSet {
  originNode?: Node;
  origin?: OriginKind;
  credentials?: Node;
}

export const corsCredentialsWildcard: Rule = {
  meta: {
    id: 'web/cors-credentials-wildcard',
    level: 'block',
    scope: 'file',
    title: 'CORS allows any origin with credentials',
    summary: 'Access-Control-Allow-Origin set to * or to the request\'s own Origin while Access-Control-Allow-Credentials is true, in header objects, header calls, the cors package, Hono, Fastify, Koa, NestJS, Next.js headers(), vercel.json, or netlify.toml.',
    why: 'With credentials allowed, a reflected origin lets any website make requests with the user\'s cookies and read the responses, which exposes account data to every page the user visits. A literal * with credentials is rejected by browsers, and the usual follow-up of echoing the Origin header opens that hole.',
    fix: 'Allow only a fixed list of trusted origins when credentials are enabled.',
    cwe: ['CWE-942', 'CWE-346'],
    owasp: ['A01:2025', 'A02:2025'],
    levels: 'block, except in example, sample, and demo folders, where it is warn.',
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test'),
  text(ctx) {
    const base = ctx.file.path.slice(ctx.file.path.lastIndexOf('/') + 1);
    if (!/access-control-allow-credentials/i.test(ctx.text)) return;
    if (base === 'vercel.json') {
      const s = parseStructured(ctx.text, 'json');
      const data = s.data;
      if (!isRecord(data) || !Array.isArray(data.headers)) return;
      data.headers.forEach((rule: unknown, i: number) => {
        if (!isRecord(rule) || !Array.isArray(rule.headers)) return;
        const list = rule.headers as unknown[];
        const idx = (re: RegExp) => list.findIndex((h) => isRecord(h) && typeof h.key === 'string' && re.test(h.key));
        const o = idx(ACAO);
        const c = idx(ACAC);
        if (o === -1 || c === -1) return;
        const oh = list[o] as Record<string, unknown>;
        const ch = list[c] as Record<string, unknown>;
        if (String(oh.value).trim() !== '*' || String(ch.value).trim().toLowerCase() !== 'true') return;
        ctx.report({ line: s.lineOf(['headers', i, 'headers', o]) ?? 1, message: headerMessage('wildcard', `vercel.json (headers for ${String(rule.source ?? 'a route')})`), fix: FIX_WILDCARD, level: exampleLevel(ctx.file) });
      });
      return;
    }
    if (base === 'netlify.toml' || base === '_headers') {
      // Blocks start at [[headers]] (netlify.toml) or at an unindented path line (_headers).
      const starts = ctx.lines.map((l, i) => (base === 'netlify.toml' ? /^\s*\[\[headers\]\]/.test(l) : /^\S/.test(l) && !/^#/.test(l)) ? i : -1).filter((i) => i >= 0);
      starts.forEach((start, k) => {
        const end = starts[k + 1] ?? ctx.lines.length;
        let originLine = -1;
        let credentials = false;
        for (let i = start; i < end; i++) {
          const line = ctx.lines[i] as string;
          const m = /^\s*"?(access-control-allow-(origin|credentials))"?\s*[:=]\s*"?([^"\s#]+)"?/i.exec(line);
          if (!m) continue;
          if (/origin/i.test(m[2] as string) && m[3] === '*') originLine = i + 1;
          if (/credentials/i.test(m[2] as string) && (m[3] as string).toLowerCase() === 'true') credentials = true;
        }
        if (originLine > 0 && credentials) ctx.report({ line: originLine, message: headerMessage('wildcard', base), fix: FIX_WILDCARD, level: exampleLevel(ctx.file) });
      });
    }
  },
  js(ctx) {
    let bindings: Bindings | null = null;
    const b = () => (bindings ??= new Bindings(ctx.program.program));
    const perFunction = new Map<Node, HeaderSet>();
    const enclosing = (): Node => {
      for (let i = ctx.parents.length - 1; i >= 0; i--) if (isFunctionNode(ctx.parents[i] as Node)) return ctx.parents[i] as Node;
      return ctx.program.program;
    };
    const fnOrNull = (): Node | null => {
      const fn = enclosing();
      return fn === ctx.program.program ? null : fn;
    };
    const reportKind = (node: Node, kind: OriginKind, text: string) => {
      if (kind === 'other') return;
      ctx.report(node, { message: text, fix: kind === 'wildcard' ? FIX_WILDCARD : FIX_REFLECTED, key: kind, level: exampleLevel(ctx.file) });
    };

    /** cors packages: returns the origin kind implied by the options, or null when credentials are off. */
    const checkCorsOptions = (node: Node, options: Node | null, where: string, defaultKind: OriginKind) => {
      const o = b().follow(options, ctx.parents);
      if (!o || o.type !== 'ObjectExpression') return;
      const credProp = o.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'credentials');
      if (!credProp || credProp.type !== 'ObjectProperty' || !isTrue(credProp.value as Node)) return;
      const originProp = o.properties.find((p) => (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && keyName(p) === 'origin');
      const originValue = originProp ? (originProp.type === 'ObjectProperty' ? (originProp.value as Node) : originProp) : null;
      if (o.properties.some((p) => p.type === 'SpreadElement') && !originProp) return;
      const { kind, detail } = corsOriginOption(originValue, b(), ctx.parents, defaultKind);
      reportKind(originProp ?? credProp ?? node, kind, corsMessage(kind, where, detail));
    };

    return {
      ObjectExpression(node: ObjectExpression) {
        // Header objects: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' }
        let origin: Node | null = null;
        let credentials: Node | null = null;
        for (const p of node.properties) {
          if (p.type !== 'ObjectProperty') continue;
          const key = keyName(p);
          if (!key) continue;
          if (ACAO.test(key)) origin = p;
          else if (ACAC.test(key)) credentials = p.value as Node;
        }
        if (!origin || !credentials || !/^true$/i.test(String(stringValue(credentials) ?? boolValue(credentials)))) return;
        const kind = originKind((origin as { value: Node }).value, ctx, b(), ctx.parents, fnOrNull());
        reportKind(origin, kind, headerMessage(kind, 'This header object'));
      },
      ArrayExpression(node: ArrayExpression) {
        // Next.js headers(): [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Access-Control-Allow-Credentials', value: 'true' }]
        let origin: Node | null = null;
        let originValue: Node | null = null;
        let credentials = false;
        for (const e of node.elements) {
          if (!e || e.type !== 'ObjectExpression') continue;
          const keyProp = e.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'key');
          const valueProp = e.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'value');
          if (!keyProp || !valueProp || keyProp.type !== 'ObjectProperty' || valueProp.type !== 'ObjectProperty') continue;
          const key = stringValue(keyProp.value as Node) ?? '';
          if (ACAO.test(key)) {
            origin = e;
            originValue = valueProp.value as Node;
          } else if (ACAC.test(key) && /^true$/i.test(stringValue(valueProp.value as Node) ?? String(boolValue(valueProp.value as Node)))) credentials = true;
        }
        if (!origin || !credentials) return;
        const kind = originKind(originValue, ctx, b(), ctx.parents, fnOrNull());
        reportKind(origin, kind, headerMessage(kind, 'This headers() rule'));
      },
      CallExpression(node) {
        const callee = node.callee as Node;
        const args = node.arguments as Node[];
        const canonical = ctx.imports.canonical(callee) ?? '';

        // cors(options) from the cors package (Express, Connect), Hono, and Koa.
        if (/^cors#(default|\*)$/.test(canonical)) {
          checkCorsOptions(node, args[0] ?? null, 'cors()', 'wildcard');
          return;
        }
        if (canonical === 'hono/cors#cors') {
          checkCorsOptions(node, args[0] ?? null, 'cors()', 'wildcard');
          return;
        }
        if (/^@koa\/cors#(default|\*)$/.test(canonical)) {
          checkCorsOptions(node, args[0] ?? null, 'cors()', 'reflected');
          return;
        }
        const method = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression' ? propertyName(callee) : null;
        // fastify.register(cors, options)
        if (method === 'register' && /^(@fastify\/cors|fastify-cors)#(default|\*)$/.test(ctx.imports.canonical(args[0]) ?? '')) {
          checkCorsOptions(node, args[1] ?? null, 'register(cors)', 'wildcard');
          return;
        }
        // NestJS: app.enableCors(options), NestFactory.create(AppModule, { cors: options })
        if (method === 'enableCors') {
          checkCorsOptions(node, args[0] ?? null, 'enableCors()', 'wildcard');
          return;
        }
        if (canonical === '@nestjs/core#NestFactory.create') {
          const opts = b().follow(args[1] ?? null, ctx.parents);
          const cors = opts?.type === 'ObjectExpression' ? opts.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'cors') : undefined;
          if (cors && cors.type === 'ObjectProperty') checkCorsOptions(node, cors.value as Node, 'NestFactory.create({ cors })', 'wildcard');
          return;
        }

        // res.setHeader('Access-Control-Allow-Origin', ...), headers.set(...), c.header(...), reply.header(...)
        if (!method || !/^(setHeader|set|header|append)$/.test(method)) return;
        const name = stringValue(args[0]) ?? '';
        if (!ACAO.test(name) && !ACAC.test(name)) return;
        const fn = enclosing();
        const set = perFunction.get(fn) ?? {};
        if (ACAO.test(name)) {
          set.originNode = node;
          set.origin = originKind(args[1], ctx, b(), ctx.parents, fn === ctx.program.program ? null : fn);
        } else if (/^true$/i.test(stringValue(args[1]) ?? String(boolValue(args[1])))) {
          set.credentials = node;
        }
        perFunction.set(fn, set);
      },
      'Program:exit'() {
        for (const set of perFunction.values()) {
          if (!set.originNode || !set.credentials || !set.origin) continue;
          const call = set.originNode as { callee: Node };
          const recv = memberPath((call.callee as { object?: Node }).object) ?? 'headers';
          const credLine = set.credentials.loc?.start.line ?? 1;
          const sameLine = credLine === (set.originNode.loc?.start.line ?? 0);
          reportKind(set.originNode, set.origin, headerMessage(set.origin, `${recv}.${lastSegment(memberPath(call.callee))}()`, sameLine ? undefined : credLine));
        }
      },
    };
  },
};
