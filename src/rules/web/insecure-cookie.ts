import type { Node } from '@babel/types';
import { boolValue, keyName, memberPath, propertyName, stringValue, unwrap } from '../../lang/js.ts';
import type { JsContext, Rule } from '../types.ts';
import { Bindings, inDevelopmentBranch, isCall, lastSegment, staticString, templateShape } from './pattern-ast.ts';
import { authCookieLabel } from './pattern-names.ts';

/**
 * Session and token cookies set without httpOnly or without secure. Covers
 * Next.js `cookies().set()` and `response.cookies.set()`, Express
 * `res.cookie()`, Hono and h3 `setCookie()`, SvelteKit and Astro
 * `cookies.set()`, `cookie.serialize()`, Remix `createCookie()`, raw
 * Set-Cookie header strings, and cookies written from browser JavaScript
 * (`document.cookie`, js-cookie), which can never be httpOnly.
 *
 * Only auth-shaped cookie names are checked. Options that cannot be resolved
 * in the file are assumed to be right, a `secure` value that is an expression
 * (`process.env.NODE_ENV === 'production'`) counts as secure, and SvelteKit
 * and Koa, whose defaults are httpOnly and secure, are reported only for an
 * explicit `false`.
 */

type Flag = 'set' | 'missing' | 'false' | 'unknown';

interface CookieFlags {
  httpOnly: Flag;
  secure: Flag;
  deleting: boolean;
}

interface Site {
  node: Node;
  /** How the code sets the cookie, for the message: res.cookie(), cookies().set(). */
  api: string;
  nameNode: Node | null;
  flags: CookieFlags | null;
  /** Framework defaults are httpOnly and secure (SvelteKit, Koa): only explicit false is reported. */
  secureDefaults?: boolean;
  /** Set from browser JavaScript: never httpOnly. */
  script?: boolean;
}

const UNKNOWN: CookieFlags = { httpOnly: 'unknown', secure: 'unknown', deleting: false };

function flagOf(obj: Node & { properties: Node[] }, names: string[]): Flag | null {
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty') continue;
    const key = keyName(p)?.toLowerCase();
    if (!key || !names.includes(key)) continue;
    const v = boolValue(p.value as Node);
    return v === false ? 'false' : 'set';
  }
  return null;
}

/** httpOnly and secure from an options object, following same-file constants and spreads. */
function optionFlags(node: Node | null | undefined, b: Bindings, parents: readonly Node[], depth = 0): CookieFlags {
  if (!node) return { httpOnly: 'missing', secure: 'missing', deleting: false };
  const n = b.follow(node, parents);
  if (!n || n.type !== 'ObjectExpression' || depth > 3) return UNKNOWN;
  let httpOnly: Flag = flagOf(n, ['httponly']) ?? 'missing';
  let secure: Flag = flagOf(n, ['secure']) ?? 'missing';
  // Hono: { prefix: 'secure' | 'host' } makes the cookie secure.
  const prefix = n.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'prefix');
  if (prefix && prefix.type === 'ObjectProperty' && /^(secure|host)$/.test(stringValue(prefix.value as Node) ?? '')) secure = 'set';
  for (const p of n.properties) {
    if (p.type !== 'SpreadElement') continue;
    const inner = optionFlags(p.argument as Node, b, parents, depth + 1);
    if (httpOnly === 'missing') httpOnly = inner.httpOnly === 'missing' ? 'missing' : inner.httpOnly;
    if (secure === 'missing') secure = inner.secure === 'missing' ? 'missing' : inner.secure;
  }
  return { httpOnly, secure, deleting: deletes(n) };
}

/** maxAge: 0 or expires: new Date(0) clears the cookie; its flags do not matter. */
function deletes(obj: Node & { properties: Node[] }): boolean {
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty') continue;
    const key = keyName(p);
    const v = unwrap(p.value as Node);
    if ((key === 'maxAge' || key === 'max-age') && v?.type === 'NumericLiteral' && v.value <= 0) return true;
    if (key === 'expires' && v?.type === 'NewExpression' && memberPath(v.callee) === 'Date' && v.arguments.length === 1 && unwrap(v.arguments[0] as Node)?.type === 'NumericLiteral') return true;
  }
  return false;
}

/** Name and flags of a Set-Cookie string or template: `token=${t}; Path=/; HttpOnly`. */
function parseCookieString(node: Node | null | undefined): { nameNode: Node | null; name: string | null; flags: CookieFlags } | null {
  const n = unwrap(node);
  const shape = templateShape(n);
  if (!n || !shape) return null;
  const semi = shape.text.indexOf(';');
  const head = semi === -1 ? shape.text : shape.text.slice(0, semi);
  const attrs = semi === -1 ? '' : shape.text.slice(semi);
  const eq = head.indexOf('=');
  if (eq === -1) return null;
  let name: string | null = head.slice(0, eq).trim();
  let nameNode: Node | null = null;
  if (name.includes('\u0000')) {
    // `${NAME}=${value}; ...`: the name is the first expression.
    if (name === '\u0000' && n.type === 'TemplateLiteral') nameNode = n.expressions[0] as Node;
    else if (name === '\u0000' && n.type === 'BinaryExpression') nameNode = leftmost(n);
    name = null;
  }
  const dynamicAttrs = attrs.includes('\u0000');
  const has = (flag: string) => new RegExp(`;\\s*${flag}\\s*(;|$|=)`, 'i').test(attrs);
  const flags: CookieFlags = {
    httpOnly: has('httponly') ? 'set' : dynamicAttrs ? 'unknown' : 'missing',
    secure: has('secure') ? 'set' : dynamicAttrs ? 'unknown' : 'missing',
    deleting: /max-age\s*=\s*0\b|expires\s*=\s*thu,\s*01[\s-]jan[\s-]1970/i.test(attrs),
  };
  return { nameNode, name, flags };
}

function leftmost(n: Node): Node {
  let x = n;
  while (x.type === 'BinaryExpression') x = x.left as Node;
  return x;
}

/**
 * A cookie name from a node: 'session', SESSION_COOKIE ('sid'), COOKIES.session, or an unresolved
 * constant named like SESSION_COOKIE_NAME. `display` is how the message names it.
 */
function cookieName(node: Node | null, b: Bindings, parents: readonly Node[]): { name: string; display: string } | null {
  if (!node) return null;
  const value = staticString(node, b, parents);
  if (value !== null) return { name: value, display: `'${value}'` };
  const path = memberPath(node);
  if (!path || path.endsWith(')')) return null;
  const bare = lastSegment(path).replace(/(_?COOKIE)?(_?NAME|_?KEY)$|(Cookie)?(Name|Key)$|_?COOKIE$|Cookie$/, '');
  return bare && bare !== lastSegment(path) ? { name: bare, display: path } : null;
}

const NEXT_RESPONSE = /^(NextResponse\.(next|json|redirect|rewrite)|new NextResponse)\(\)$/;

/** Which cookie API a `.set()` receiver is, or null when it is not a response cookie store. */
function cookieStore(receiver: Node, ctx: JsContext, b: Bindings): { api: string; secureDefaults: boolean } | null {
  const r = unwrap(receiver);
  if (!r) return null;
  const fw = ctx.project.frameworksFor(ctx.file.path);
  const nextCookies = (n: Node | null): boolean => {
    const u = unwrap(n);
    return !!u && isCall(u) && ctx.imports.canonical(u.callee) === 'next/headers#cookies';
  };
  if (nextCookies(r)) return { api: 'cookies().set()', secureDefaults: false };
  if (r.type === 'Identifier') {
    const init = b.follow(r, ctx.parents);
    if (init && init !== r && nextCookies(init)) return { api: `${r.name}.set()`, secureDefaults: false };
    if (r.name === 'cookies' || r.name === 'cookieStore') {
      // Destructured from a SvelteKit or Astro event: ({ cookies }) => ...
      if (fw.has('sveltekit')) return { api: 'cookies.set()', secureDefaults: true };
      if (fw.has('astro')) return { api: 'cookies.set()', secureDefaults: false };
      if (fw.has('next') && init && nextCookies(init)) return { api: 'cookies.set()', secureDefaults: false };
    }
    return null;
  }
  const path = memberPath(r);
  if (!path || !path.endsWith('.cookies')) return null;
  const head = path.slice(0, -'.cookies'.length);
  if (/^(req|request)$/.test(head) || /\.(req|request)$/.test(head)) return null; // request cookies, not the response
  if (/^(event|Astro|context|locals)$/.test(head) || /^(event|Astro|context)\./.test(head)) {
    if (fw.has('sveltekit') && !fw.has('astro')) return { api: `${path}.set()`, secureDefaults: true };
    return { api: `${path}.set()`, secureDefaults: false };
  }
  if (head === 'ctx' && ctx.project.depsFor(ctx.file.path).has('koa')) return { api: 'ctx.cookies.set()', secureDefaults: true };
  if (/^(res|response|resp|nextResponse|redirectResponse|out)$/i.test(head) || NEXT_RESPONSE.test(head)) return { api: `${head.replace(/\(\)$/, '()')}.cookies.set()`, secureDefaults: false };
  if (/^[A-Za-z_$][\w$]*$/.test(head)) {
    const init = b.follow({ type: 'Identifier', name: head } as Node, ctx.parents);
    const initPath = init ? memberPath(init) : null;
    if (initPath && NEXT_RESPONSE.test(initPath)) return { api: `${head}.cookies.set()`, secureDefaults: false };
  }
  return null;
}

function describeFlags(site: Site, label: string, display: string): { message: string; fix?: string } | null {
  if (site.flags?.deleting) return null;
  if (site.script) {
    return {
      message: `${site.api} sets the ${label} cookie ${display} from browser JavaScript, so it cannot be httpOnly and any script on the page can read it.`,
      fix: 'Set the cookie from server code with httpOnly and secure, and let the browser send it automatically.',
    };
  }
  const f = site.flags;
  if (!f || f.deleting) return null;
  const strict = site.secureDefaults === true;
  const noHttpOnly = f.httpOnly === 'false' || (!strict && f.httpOnly === 'missing');
  const noSecure = f.secure === 'false' || (!strict && f.secure === 'missing');
  if (!noHttpOnly && !noSecure) return null;
  const how = (flag: Flag, option: string) => (flag === 'false' ? `with ${option}: false` : `without ${option}`);
  if (noHttpOnly && noSecure) {
    const both = f.httpOnly === 'false' || f.secure === 'false' ? `${how(f.httpOnly, 'httpOnly')} and ${how(f.secure, 'secure').replace(/^with /, '')}` : 'without httpOnly and secure';
    return { message: `${site.api} sets the ${label} cookie ${display} ${both}, so scripts on the page can read it and the browser also sends it over plain HTTP.` };
  }
  if (noHttpOnly) return { message: `${site.api} sets the ${label} cookie ${display} ${how(f.httpOnly, 'httpOnly')}, so scripts on the page can read it.` };
  return { message: `${site.api} sets the ${label} cookie ${display} ${how(f.secure, 'secure')}, so the browser also sends it over plain HTTP.` };
}

export const insecureCookie: Rule = {
  meta: {
    id: 'web/insecure-cookie',
    level: 'warn',
    scope: 'file',
    title: 'Session cookie without httpOnly or secure',
    summary: 'A cookie named like a session or token (session, sid, token, auth, jwt, access_token, refresh_token, remember) set without httpOnly or without secure, or set from browser JavaScript.',
    why: 'Without httpOnly, any script on the page (an XSS bug, a compromised dependency) can read the session cookie and use it elsewhere. Without secure, the browser also sends it over plain HTTP, where it can be intercepted.',
    fix: 'Set the cookie with httpOnly: true and secure: true (secure may depend on NODE_ENV for local development).',
    cwe: ['CWE-1004', 'CWE-614'],
    owasp: ['A07:2025'],
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test'),
  js(ctx) {
    let bindings: Bindings | null = null;
    const b = () => (bindings ??= new Bindings(ctx.program.program));
    const definedHere = (name: string) =>
      ctx.program.program.body.some(
        (s) =>
          (s.type === 'FunctionDeclaration' && s.id?.name === name) ||
          (s.type === 'ExportNamedDeclaration' && s.declaration?.type === 'FunctionDeclaration' && s.declaration.id?.name === name) ||
          (s.type === 'VariableDeclaration' && s.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === name)),
      );
    const report = (site: Site) => {
      const cookie = cookieName(site.nameNode, b(), ctx.parents);
      if (!cookie) return;
      const label = authCookieLabel(cookie.name);
      if (!label) return;
      if (site.flags && site.flags.secure === 'missing' && inDevelopmentBranch(site.node, ctx.parents)) site.flags = { ...site.flags, secure: 'set' };
      const d = describeFlags(site, label, cookie.display);
      if (!d) return;
      ctx.report(site.node, { message: d.message, ...(d.fix ? { fix: d.fix } : {}), key: cookie.name });
    };
    const reportString = (node: Node, api: string, value: Node | null, script: boolean) => {
      const v = b().follow(value, ctx.parents);
      if (!v) return;
      const items = v.type === 'ArrayExpression' ? (v.elements.filter(Boolean) as Node[]) : [v];
      for (const item of items) {
        const parsed = parseCookieString(b().follow(item, ctx.parents));
        if (!parsed) continue;
        const nameNode: Node | null = parsed.name !== null ? ({ type: 'StringLiteral', value: parsed.name } as Node) : parsed.nameNode;
        report({ node, api, nameNode, flags: parsed.flags, script });
      }
    };

    return {
      CallExpression(node) {
        const callee = node.callee as Node;
        const args = node.arguments as Node[];
        const canonical = ctx.imports.canonical(callee) ?? '';
        const method = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression' ? propertyName(callee) : null;

        // Set-Cookie headers: res.setHeader('Set-Cookie', ...), headers.append('Set-Cookie', ...), c.header('Set-Cookie', ...)
        if (method && /^(setHeader|set|append|header)$/.test(method) && /^set-cookie$/i.test(stringValue(args[0]) ?? '')) {
          reportString(node, `${method}('Set-Cookie')`, args[1] ?? null, false);
          return;
        }

        // cookie.serialize(name, value, options)
        if (/^cookie#(serialize|default\.serialize)$/.test(canonical)) {
          report({ node, api: 'serialize()', nameNode: args[0] ?? null, flags: optionFlags(args[2], b(), ctx.parents) });
          return;
        }

        // js-cookie: Cookies.set(name, value, options) runs in the browser.
        if (/^js-cookie#(set|default\.set)$/.test(canonical)) {
          report({ node, api: 'Cookies.set()', nameNode: args[0] ?? null, flags: null, script: true });
          return;
        }

        // Hono and h3: setCookie(c, name, value, options); setSignedCookie(c, name, value, secret, options)
        if (/^(hono\/cookie|h3|nuxt\/app|#imports|vinxi\/http)#setCookie$/.test(canonical)) {
          report({ node, api: 'setCookie()', nameNode: args[1] ?? null, flags: optionFlags(args[3], b(), ctx.parents) });
          return;
        }
        if (canonical === 'hono/cookie#setSignedCookie') {
          report({ node, api: 'setSignedCookie()', nameNode: args[1] ?? null, flags: optionFlags(args[4], b(), ctx.parents) });
          return;
        }
        if (canonical === 'setCookie' && !definedHere('setCookie') && ctx.project.frameworksFor(ctx.file.path).has('nuxt') && args.length >= 3) {
          report({ node, api: 'setCookie()', nameNode: args[1] ?? null, flags: optionFlags(args[3], b(), ctx.parents) });
          return;
        }
        // cookies-next: setCookie(name, value, options); nookies: setCookie(ctx, name, value, options)
        if (/^cookies-next#(setCookie|default\.setCookie)$/.test(canonical)) {
          report({ node, api: 'setCookie()', nameNode: args[0] ?? null, flags: ctx.file.client && !ctx.file.server ? null : optionFlags(args[2], b(), ctx.parents), script: ctx.file.client && !ctx.file.server });
          return;
        }
        if (/^nookies#(setCookie|set|default\.set)$/.test(canonical)) {
          report({ node, api: 'setCookie()', nameNode: args[1] ?? null, flags: optionFlags(args[3], b(), ctx.parents) });
          return;
        }

        // Remix and React Router: createCookie(name, options), createCookieSessionStorage({ cookie: {...} })
        if (/#createCookie$/.test(canonical) && /(@remix-run|react-router)/.test(canonical)) {
          report({ node, api: 'createCookie()', nameNode: args[0] ?? null, flags: optionFlags(args[1], b(), ctx.parents) });
          return;
        }
        if (/#create(Cookie|Memory|File|Workers?KV|Cloudflare\w*)SessionStorage$/.test(canonical) && /(@remix-run|react-router)/.test(canonical)) {
          const cookie = b().follow(args[0] ?? null, ctx.parents);
          const opt = cookie?.type === 'ObjectExpression' ? cookie.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'cookie') : undefined;
          const value = opt && opt.type === 'ObjectProperty' ? b().follow(opt.value as Node, ctx.parents) : null;
          if (value?.type !== 'ObjectExpression') return;
          const nameProp = value.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'name');
          const nameNode = nameProp && nameProp.type === 'ObjectProperty' ? (nameProp.value as Node) : null;
          report({ node, api: 'createCookieSessionStorage()', nameNode, flags: optionFlags(value, b(), ctx.parents) });
          return;
        }

        if (!method || (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression')) return;
        const receiver = callee.object as Node;

        // Express res.cookie(name, value, options) and Fastify reply.setCookie(name, value, options)
        if ((method === 'cookie' || method === 'setCookie') && args.length >= 2) {
          const recv = memberPath(receiver) ?? '';
          if (!/^(res|response|resp|reply|ctx\.res|c\.res)$/.test(recv)) return;
          report({ node, api: `${recv}.${method}()`, nameNode: args[0] ?? null, flags: optionFlags(args[2], b(), ctx.parents) });
          return;
        }

        // Cookie stores: cookies().set(), response.cookies.set(), event.cookies.set(), ({ cookies }) => cookies.set()
        if (method === 'set') {
          const store = cookieStore(receiver, ctx, b());
          if (!store) return;
          const first = unwrap(args[0]);
          if (first?.type === 'ObjectExpression') {
            const nameProp = first.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'name');
            const nameNode = nameProp && nameProp.type === 'ObjectProperty' ? (nameProp.value as Node) : null;
            report({ node, api: store.api, nameNode, flags: optionFlags(first, b(), ctx.parents), secureDefaults: store.secureDefaults });
            return;
          }
          const value = unwrap(args[1]);
          if (value && stringValue(value) === '' && !args[2]) return; // clearing the cookie
          report({ node, api: store.api, nameNode: args[0] ?? null, flags: optionFlags(args[2], b(), ctx.parents), secureDefaults: store.secureDefaults });
        }
      },
      AssignmentExpression(node) {
        // document.cookie = 'token=...'
        if (memberPath(node.left) !== 'document.cookie' || node.operator !== '=') return;
        reportString(node, 'document.cookie', node.right as Node, true);
      },
      ObjectProperty(node) {
        // { headers: { 'Set-Cookie': `session=${id}; Path=/` } }
        if (!/^set-cookie$/i.test(keyName(node) ?? '')) return;
        reportString(node, "the 'Set-Cookie' header", node.value as Node, false);
      },
    };
  },
};
