import type { Node } from '@babel/types';
import { boolValue, keyName, memberPath, propertyName, stringValue, unwrap } from '../../lang/js.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import type { Rule } from '../types.ts';
import { Bindings, callsIn, exampleLevel, functionName, isCall, lastSegment } from './pattern-ast.ts';

/**
 * JWT claims trusted without a signature check:
 *
 * - `jwt.decode()` (jsonwebtoken), `decodeJwt()` (jose), `jwtDecode()`
 *   (jwt-decode), and Hono's `decode()` whose claims decide access (a branch
 *   on a claim, a database lookup by a claim, the claims stored as the
 *   request's user, or returned from an auth helper) with no verify call on
 *   the same token in the same function. Other uses (display, logging) are
 *   warn, and so are tokens from a network response (a provider's token
 *   endpoint) and checks of `exp` alone. A decode in a helper that a
 *   verifying function in the same file calls (decode to find the key, then
 *   verify) and a decode of a token the same function just signed are not
 *   reported.
 * - `algorithms: ['none']` / `algorithm: 'none'`, which accept unsigned tokens.
 * - `ignoreExpiration: true`, which accepts expired tokens.
 *
 * Browser-only modules are skipped: decisions there are UI and the server
 * has to verify anyway.
 */

const DECODE = /^(jsonwebtoken#(decode|default\.decode)|jose#decodeJwt|jwt-decode#(jwtDecode|default)|hono\/jwt#decode|hono\/utils\/jwt\/jwt#decode|@tsndr\/cloudflare-worker-jwt#decode|jws#decode)$/;
const JWT_LIBS = /^(jsonwebtoken|jose|express-jwt|passport-jwt|jwt-simple|@fastify\/jwt|hono\/jwt|koa-jwt|@nestjs\/jwt|@tsndr\/cloudflare-worker-jwt|jws|njwt|fast-jwt|@hapi\/jwt|elysia-jwt|@elysiajs\/jwt)$/;
const SIGN = /(^|[.#])(sign|signJwt|signToken|createToken|generateToken|encode)$|SignJWT/;
const TIME_CLAIMS = new Set(['exp', 'iat', 'nbf', 'expiresAt', 'expires', 'expiresIn', 'auth_time']);
const AUTH_FUNCTION = /^(verify|authenticate|authorize|getUser|getCurrentUser|currentUser|getSession|getServerSession|requireAuth|requireUser|requireAdmin|checkAuth|checkAdmin|ensureAuth|isAdmin|isAuthenticated|isAuthorized|getAuth|whoami|getUserId|getUserFrom|getAccount|getMember|validateToken|validateSession|validateUser|protect|guard|auth)/i;
const DATA_CALL = /(^|\.)(find\w*|get\w*|fetch\w*|load\w*|select\w*|query\w*|update\w*|delete\w*|remove\w*|insert\w*|upsert\w*|create\w*|save\w*|exec\w*|where|eq|match|lookup\w*|read\w*|from|filter|aggregate|count\w*|set)$/;
const DISPLAY_CALL = /(^|\.)(log|info|warn|error|debug|trace|json|send|render|write|end|stringify|toString|redirect|next)$|^console\./;
const IDENTITY_TARGET = /^(req|request|ctx|context|event|c|res|locals|session)\.(user|auth|session|claims|identity|account|principal|locals|state)(\.|$)|^(res|event|context)\.locals\.|^ctx\.state\./;

interface Decision {
  kind: 'branch' | 'query' | 'identity' | 'return';
  /** The claim or value used: decoded.role, payload.sub. */
  what: string;
  /** The call, assignment target, or function involved: prisma.user.findUnique, req.user, getUserFromToken. */
  target: string;
  line: number;
  timeOnly: boolean;
}

/** How the decoded claims are used in the function: the strongest use wins. */
function classifyUses(decodeCall: Node, parents: readonly Node[], fn: Node | null, fnName: string | null): Decision | null {
  const found: Decision[] = [];
  const decodedName = `${memberPath((decodeCall as { callee: Node }).callee) ?? 'decode'}()`;

  /**
   * Walk up from an expression that holds claims to where it is used. `base` is the claim path the
   * start expression already holds (for a destructured `{ sub }`, 'sub'); `label` is how the message names it.
   */
  const useOf = (start: Node, chain: readonly Node[], base: string | null, label: string, depth: number): void => {
    let child: Node = start;
    let extra: string | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const p = chain[i] as Node;
      const line = child.loc?.start.line ?? 1;
      const currentClaim = [base, extra].filter(Boolean).join('.') || null;
      const what = extra ? `${label}.${extra}` : label;
      const time = currentClaim !== null && TIME_CLAIMS.has(currentClaim.split('.').pop() as string);
      switch (p.type) {
        case 'MemberExpression':
        case 'OptionalMemberExpression': {
          if (p.object !== child) return;
          const prop = propertyName(p);
          if (!prop) return;
          extra = extra ? `${extra}.${prop}` : prop;
          break;
        }
        case 'CallExpression':
        case 'OptionalCallExpression': {
          if (p.callee === child) return; // decoded.claims.includes(...) and friends: treat as a read
          const callee = memberPath(p.callee as Node) ?? '';
          if (/^(String|Number|parseInt|BigInt|Boolean)$/.test(callee)) break;
          // Query-builder operators: eq(users.id, claims.sub) inside .where(...)
          if (/^(eq|ne|and|or|not|like|ilike|inArray|gt|gte|lt|lte|sql|Op\.\w+)$/.test(callee)) break;
          if (DISPLAY_CALL.test(callee)) return;
          if (/(^|\.)(set)$/.test(callee) && /^(c|ctx|context)\.set$/.test(callee)) {
            if (currentClaim || stringValue(p.arguments[0] as Node)) found.push({ kind: 'identity', what, target: `${callee}('${stringValue(p.arguments[0] as Node) ?? ''}')`, line, timeOnly: false });
            return;
          }
          if (DATA_CALL.test(callee) && currentClaim) {
            found.push({ kind: 'query', what, target: callee, line, timeOnly: time });
            return;
          }
          return;
        }
        case 'ObjectProperty':
        case 'ObjectExpression':
        case 'ArrayExpression':
        case 'SpreadElement':
        case 'TemplateLiteral':
        case 'TSAsExpression':
        case 'TSNonNullExpression':
        case 'TSSatisfiesExpression':
        case 'ParenthesizedExpression':
        case 'AwaitExpression':
          if (p.type === 'ObjectProperty' && p.value !== child) return;
          break;
        case 'LogicalExpression':
        case 'ConditionalExpression':
          if (p.type === 'ConditionalExpression' && p.test === child) {
            if (currentClaim) found.push({ kind: 'branch', what, target: '', line, timeOnly: time });
            return;
          }
          if (p.type === 'LogicalExpression' && currentClaim && isTestPosition(p, chain.slice(0, i))) {
            found.push({ kind: 'branch', what, target: '', line, timeOnly: time });
            return;
          }
          break;
        case 'BinaryExpression':
          if (['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(p.operator)) {
            if (currentClaim) found.push({ kind: 'branch', what, target: '', line, timeOnly: time });
            return;
          }
          break; // decoded.exp * 1000 < Date.now(): arithmetic, keep going up
        case 'UnaryExpression':
          if (p.operator === 'typeof') break;
          if (p.operator === '!' && currentClaim) found.push({ kind: 'branch', what, target: '', line, timeOnly: time });
          return;
        case 'IfStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'SwitchStatement':
          if (currentClaim && ((p as { test?: Node }).test === child || (p as { discriminant?: Node }).discriminant === child)) found.push({ kind: 'branch', what, target: '', line, timeOnly: time });
          return;
        case 'AssignmentExpression': {
          if (p.right !== child) return;
          const target = memberPath(p.left) ?? '';
          if (IDENTITY_TARGET.test(target)) {
            found.push({ kind: 'identity', what, target, line, timeOnly: false });
            return;
          }
          if (p.left.type === 'Identifier' && depth < 2 && fn) followName(p.left.name, currentClaim ?? '', depth + 1, p.left.name);
          return;
        }
        case 'VariableDeclarator': {
          if (p.init !== child || !fn) return;
          if (p.id.type === 'Identifier') followName(p.id.name, currentClaim ?? '', depth + 1, p.id.name);
          else if (p.id.type === 'ObjectPattern') {
            for (const prop of p.id.properties) {
              if (prop.type !== 'ObjectProperty') continue;
              const key = keyName(prop);
              const value = prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value;
              if (key && value.type === 'Identifier') followName(value.name, currentClaim ? `${currentClaim}.${key}` : key, depth + 1, value.name);
            }
          }
          return;
        }
        case 'ReturnStatement':
        case 'ArrowFunctionExpression':
          if (p.type === 'ArrowFunctionExpression' && p.body !== child) return;
          if (fnName && AUTH_FUNCTION.test(fnName)) found.push({ kind: 'return', what, target: fnName, line, timeOnly: time });
          return;
        default:
          return;
      }
      child = p;
    }
  };

  /** Uses of a variable that holds the decoded payload (claim '') or one claim. */
  const followName = (name: string, claim: string, depth: number, label: string) => {
    if (!fn || depth > 3) return;
    const scopeParents = parents.slice(0, parents.indexOf(fn));
    walk(fn, {
      enter(node, rel) {
        if (node.type !== 'Identifier' || node.name !== name) return undefined;
        const parent = rel[rel.length - 1];
        if (!parent) return undefined;
        if (parent.type === 'VariableDeclarator' && parent.id === node) return undefined;
        if (parent.type === 'AssignmentExpression' && parent.left === node) return undefined;
        if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === node && !parent.computed) return undefined;
        if (parent.type === 'ObjectProperty' && parent.key === node && !parent.shorthand) return undefined;
        useOf(node, [...scopeParents, ...rel], claim === '' ? null : claim, label, depth);
        return undefined;
      },
    });
  };

  useOf(decodeCall, parents, null, decodedName, 0);
  if (found.length === 0) return null;
  const order = { identity: 0, query: 1, return: 2, branch: 3 };
  const strong = found.filter((d) => !d.timeOnly).sort((a, b) => order[a.kind] - order[b.kind]);
  if (strong.length > 0) return strong[0] as Decision;
  return { ...(found[0] as Decision), timeOnly: true };
}

/** A logical expression whose value is a condition (if test, ternary test, negation). */
function isTestPosition(node: Node, parents: readonly Node[]): boolean {
  let child = node;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type === 'LogicalExpression' || p.type === 'ParenthesizedExpression' || (p.type === 'UnaryExpression' && p.operator === '!')) {
      child = p;
      continue;
    }
    return ((p.type === 'IfStatement' || p.type === 'ConditionalExpression' || p.type === 'WhileStatement') && p.test === child);
  }
  return false;
}

/** A readable name for the token argument and a key to find verify calls on the same token. */
function tokenKey(node: Node | null | undefined): string | null {
  const n = unwrap(node);
  if (!n) return null;
  const path = memberPath(n);
  if (path) return path;
  return null;
}

function mentions(node: Node, key: string | null): boolean {
  if (key === null) return true;
  let found = false;
  const head = key.split('.')[0];
  walk(node, {
    enter(n) {
      if (found) return 'skip';
      const path = memberPath(n);
      if (path === key || (n.type === 'Identifier' && n.name === head)) found = true;
      return undefined;
    },
  });
  return found;
}

function isVerifyCall(call: Node & { callee: Node }, canonical: string): boolean {
  if (/^(jsonwebtoken#(verify|default\.verify)|jose#(jwtVerify|compactVerify|flattenedVerify|generalVerify|jwtDecrypt)|hono\/jwt#verify|@tsndr\/cloudflare-worker-jwt#verify|jwt-simple#decode|jws#verify)$/.test(canonical)) return true;
  const method = lastSegment(memberPath(call.callee));
  if (/verif|validateToken|validateJwt|checkToken/i.test(method)) return true;
  if (/(^|\.)auth\.(getUser|getClaims)$/.test(memberPath(call.callee) ?? '')) return true;
  return false;
}

interface Candidate {
  node: Node;
  callee: string;
  fn: Node | null;
  fnName: string | null;
  decision: Decision | null;
  external: boolean;
  tokenSource: string | null;
}

export const jwtUnverified: Rule = {
  meta: {
    id: 'web/jwt-unverified',
    level: 'block',
    scope: 'file',
    title: 'JWT claims used without verifying the signature',
    summary: 'Access decisions based on jwt.decode(), decodeJwt(), or jwtDecode() output with no verify call on the same token, JWT options that accept the none algorithm, and ignoreExpiration: true.',
    why: 'Decoding a JWT only base64-decodes it; anyone can write a token with any user ID or role. Without a signature check, the server trusts whatever the client sends, and accepting alg none or expired tokens has the same effect.',
    fix: 'Verify the token with jwt.verify() or jwtVerify() (with a fixed algorithms list) before trusting any claim.',
    cwe: ['CWE-347', 'CWE-345'],
    owasp: ['A07:2025', 'A04:2025'],
    levels: 'block when a claim decides access (a branch, a database lookup, the request user, or the return value of an auth helper); warn for display-only decodes, checks of time claims alone, tokens from a network response, and code in example, sample, and demo folders.',
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test'),
  js(ctx) {
    const candidates: Candidate[] = [];
    let jwtFile: boolean | null = null;
    const isJwtFile = () => (jwtFile ??= [...ctx.imports.bindings.values()].some((b) => JWT_LIBS.test(b.module)));
    let bindings: Bindings | null = null;
    const b = () => (bindings ??= new Bindings(ctx.program.program));
    // Browser code: decisions there are UI, and the server verifies. Frameworks the project model does not
    // know (Angular, React Native) are recognized by their imports and by browser-only APIs.
    const browserOnly =
      (ctx.file.client && !ctx.file.server) ||
      (!ctx.file.server && (ctx.imports.importsModule(/^(@angular\/|react-native$|expo(-|$)|vue$|@ionic\/)/) || /\b(localStorage|sessionStorage|document\.cookie|window\.location)\b/.test(ctx.text)));

    /** The options object belongs to a JWT call (jwt.verify, expressjwt, new JwtStrategy), or the file imports a JWT library. */
    const optionContext = (): boolean => {
      if (isJwtFile()) return true;
      for (let i = ctx.parents.length - 1; i >= 0; i--) {
        const p = ctx.parents[i] as Node;
        if (isCall(p) || p.type === 'NewExpression') return /jwt|jws|verify|sign|token/i.test(memberPath((p as { callee: Node }).callee) ?? '');
      }
      return false;
    };

    return {
      ObjectProperty(node) {
        const key = keyName(node);
        if (key === 'algorithms' || key === 'algorithm') {
          const v = b().follow(node.value as Node, ctx.parents);
          const values = v?.type === 'ArrayExpression' ? v.elements.map((e) => stringValue(e as Node)) : [stringValue(v)];
          if (!values.some((x) => x !== null && x.toLowerCase() === 'none') || !optionContext()) return;
          ctx.report(node, {
            message: key === 'algorithms'
              ? "The JWT options accept the 'none' algorithm (algorithms includes 'none'), so an unsigned token passes verification."
              : "The JWT is signed with algorithm 'none', so it carries no signature and anyone can forge one.",
            fix: "Remove 'none' and list only the algorithm your keys use, such as ['HS256'] or ['RS256'].",
            key: 'none',
            level: exampleLevel(ctx.file),
          });
          return;
        }
        if (key === 'ignoreExpiration' && boolValue(node.value as Node) === true && optionContext()) {
          ctx.report(node, {
            message: 'The JWT options set ignoreExpiration: true, so expired tokens are still accepted.',
            fix: 'Remove ignoreExpiration and let expired tokens fail; use a refresh token flow to renew sessions.',
            key: 'ignoreExpiration',
            level: exampleLevel(ctx.file),
          });
        }
      },
      CallExpression(node) {
        if (browserOnly) return;
        const canonical = ctx.imports.canonical(node.callee) ?? '';
        const isDecode = DECODE.test(canonical) || (canonical === 'jwt-simple#decode' && boolValue(node.arguments[2] as Node) === true);
        if (!isDecode) return;
        // jwt-decode is a browser library; on the server it only matters in code that is known to run there.
        if (canonical.startsWith('jwt-decode#') && !ctx.file.server) return;
        let fnIndex = -1;
        for (let i = ctx.parents.length - 1; i >= 0; i--) {
          if (isFunctionNode(ctx.parents[i] as Node)) {
            fnIndex = i;
            break;
          }
        }
        const fn = fnIndex >= 0 ? (ctx.parents[fnIndex] as Node) : null;
        const fnName = fn ? functionName(fn, ctx.parents.slice(0, fnIndex)) : null;
        const token = node.arguments[0] as Node | undefined;
        const key = tokenKey(token);
        const scope = fn ?? ctx.program.program;
        // Verified in the same function: decode to read the header or claims, then verify.
        for (const call of callsIn(scope)) {
          if (call === node) continue;
          const c = ctx.imports.canonical(call.callee) ?? '';
          if (isVerifyCall(call, c) && call.arguments.some((a) => mentions(a as Node, key))) return;
        }
        // Our own token: const token = jwt.sign(...); jwt.decode(token) to read exp.
        const tokenInit = token ? b().follow(token, ctx.parents) : null;
        if (tokenInit && isCall(tokenInit) && SIGN.test(ctx.imports.canonical(tokenInit.callee) ?? memberPath(tokenInit.callee) ?? '')) return;
        if (tokenInit && isCall(tokenInit) && /\.sign$/.test(memberPath(tokenInit.callee) ?? '')) return;
        const taint = token ? ctx.taint.taintOf(token) : null;
        candidates.push({
          node,
          callee: `${memberPath(node.callee) ?? 'decode'}()`,
          fn,
          fnName,
          decision: classifyUses(node, ctx.parents, fn, fnName),
          external: taint?.kind === 'external',
          tokenSource: taint?.kind === 'request' ? `${taint.source} (line ${taint.line})` : null,
        });
      },
      'Program:exit'() {
        if (candidates.length === 0) return;
        // Functions that verify tokens, and which named functions they call.
        const verifying = new Set<Node>();
        const callers = new Map<string, Node[]>();
        walk(ctx.program.program, {
          enter(node, parents) {
            if (!isCall(node)) return undefined;
            let fn: Node | null = null;
            for (let i = parents.length - 1; i >= 0; i--) {
              if (isFunctionNode(parents[i] as Node)) {
                fn = parents[i] as Node;
                break;
              }
            }
            if (isVerifyCall(node, ctx.imports.canonical(node.callee) ?? '')) {
              if (fn) verifying.add(fn);
            }
            const name = lastSegment(memberPath(node.callee));
            if (name && fn) {
              const list = callers.get(name) ?? [];
              list.push(fn);
              callers.set(name, list);
            }
            return undefined;
          },
        });
        for (const c of candidates) {
          // Called from a function that verifies the token: decode to look up the key, then verify.
          if (c.fnName && (callers.get(c.fnName) ?? []).some((g) => verifying.has(g))) continue;
          const d = c.decision;
          const strong = !!d && !d.timeOnly && !c.external;
          const source = c.external ? ' a token from a network response' : c.tokenSource ? ` the token from the ${c.tokenSource}` : ' the token';
          const use = !d
            ? ''
            : d.kind === 'branch'
              ? `, and ${d.what} decides a branch on line ${d.line}`
              : d.kind === 'query'
                ? `, and ${d.target}() looks up data by ${d.what} on line ${d.line}`
                : d.kind === 'identity'
                  ? `, and the claims are stored as ${d.target} on line ${d.line}`
                  : `, and ${d.target}() returns the claims as the signed-in user`;
          ctx.report(c.node, {
            level: strong ? exampleLevel(ctx.file) : 'warn',
            message: `${c.callee} reads${source} without verifying its signature${use}.`,
            ...(c.external ? { fix: "Verify the token with the provider's keys (jwtVerify() with createRemoteJWKSet()) unless it came straight from the token endpoint over TLS." } : {}),
            key: `${c.fnName ?? ''}:${c.callee}`,
          });
        }
      },
    };
  },
};
