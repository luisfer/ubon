import type { Node } from '@babel/types';
import { keyName, memberPath, stringValue, unwrap } from '../../lang/js.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import type { Rule } from '../types.ts';
import { Bindings, exampleLevel, functionName, isCall, lastSegment } from './pattern-ast.ts';
import { isContextualCredential, isSampleName, randomCredentialLabel } from './pattern-names.ts';

/**
 * Math.random() used to produce a credential. The value is followed upward
 * through the expressions that build it (toString(36), Math.floor, string
 * concatenation, picking characters from an alphabet) to where it lands: a
 * variable, a property, a setter, a storage key, or a function's return
 * value. Only when that name is credential-shaped is it reported. Values that
 * are compared (sampling), used as delays, or used to pick an item from a list
 * end the flow, so UI, jitter, retries, and list keys never match.
 */

/** Files with mock or seed data: random tokens there are sample values. */
const SAMPLE_FILE = /(^|\/)(seeds?|seeders?|mocks?|fakes?|stubs?|__mocks__)(\/|$)|(^|\/)[^/]*(seed|mock|fake|dummy|stub|faker)[^/]*\.[cm]?[jt]sx?$/i;

const PASS_THROUGH_CALLS = /^(Math\.(floor|round|ceil|trunc|abs|max|min)|Number|String|parseInt|parseFloat|btoa|encodeURIComponent|encodeURI|Buffer\.from|String\.fromCharCode|String\.fromCodePoint|BigInt)$/;
const HASH_CALLS = /(^|[.#])(createHash|createHmac|hash|hashSync|sha1|sha256|sha512|md5|digest|update|encode|base64|toBase64|btoa|hex|toHex|stringify)$/i;
const CHARSET_NAME = /char|alphabet|letter|digit|symbol|possible|charset|alnum|alphanumeric|hex|base(32|36|58|62|64)?$|pool|allowed|vocab/i;
const STORE_METHODS = new Set(['setItem', 'set', 'cookie', 'setCookie', 'setHeader', 'append', 'header']);

type Landing =
  | { kind: 'name'; name: string; how: 'variable' | 'property' | 'setter' | 'storage'; node: Node; parents: readonly Node[] }
  | { kind: 'return'; fn: Node; name: string | null; node: Node; parents: readonly Node[] };

interface Walker {
  bindings: Bindings;
  /** Neutral functions the value was returned from (randomString, makeid); their call sites are checked at the end of the file. */
  returns: string[];
}

/** Auth code by file name or folder: auth.ts, login/, reset-password.ts, verify.ts, lib/token.ts. */
const AUTH_PATH = /(^|[/_.-])(auth|authentication|login|logout|signin|sign-in|signup|sign-up|register|registration|password|passwd|reset|verify|verification|otp|mfa|2fa|invite|invitation|magic|oauth|oidc|credentials?|jwt|tokens?|api-?keys?|access-?tokens?)([/_.-]|[A-Z]|$)/i;
/** Auth work by function name: login, createSession, sendResetEmail, verifyEmail, issueToken. */
const AUTH_FUNCTION = /auth|login|logout|sign-?in|sign-?up|password|passwd|reset|verif|otp|invite|invitation|magic|oauth|credential|jwt|apikey|api_?key|(create|start|issue|new|open|begin)_?(user_?|auth_?)?session\b/i;

/**
 * True when a function around the node does auth work by its name. `except` is the function whose
 * name made the value a credential (sessionId() returning a session ID), which says nothing more.
 */
function inAuthFunction(parents: readonly Node[], except: string | null): boolean {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (!isFunctionNode(p)) continue;
    const name = functionName(p, parents.slice(0, i));
    if (name && name !== except && AUTH_FUNCTION.test(name)) return true;
  }
  return false;
}

/** True when a function around the node handles an HTTP request: (req, res) => ..., POST(request), ({ request }) => ... */
function inRequestHandler(parents: readonly Node[]): boolean {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (!isFunctionNode(p)) continue;
    const first = (p as { params?: Node[] }).params?.[0];
    if (first?.type === 'Identifier' && /^(req|request|ctx|c|event)$/.test(first.name)) return true;
    if (first?.type === 'ObjectPattern' && first.properties.some((q) => q.type === 'ObjectProperty' && /^(request|req|cookies)$/.test(keyName(q) ?? ''))) return true;
  }
  return false;
}

/** True when a function around the node builds sample data: createFakeUsers, mockSession, seedDatabase. */
function inSampleFunction(parents: readonly Node[]): boolean {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (!isFunctionNode(p)) continue;
    const name = functionName(p, parents.slice(0, i));
    if (name && isSampleName(name)) return true;
  }
  return false;
}

/** Follow a value up from `start` to where it lands. `parents` are the ancestors of `start`, outermost first. */
function land(start: Node, parents: readonly Node[], w: Walker): Landing | null {
  let child: Node = start;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    const up = parents.slice(0, i);
    switch (p.type) {
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        if (p.object === child) break; // Math.random().toString(36)
        if (p.property === child && p.computed) {
          // chars[Math.floor(Math.random() * chars.length)]: generation only when the list is an alphabet.
          if (!isCharset(p.object as Node, up, w)) return null;
          break;
        }
        return null;
      }
      case 'CallExpression':
      case 'OptionalCallExpression': {
        if (p.callee === child) break; // method call on the value
        const callee = memberPath(p.callee as Node) ?? '';
        const method = lastSegment(callee);
        const argIndex = p.arguments.indexOf(child as never);
        if (argIndex === -1) return null;
        if (PASS_THROUGH_CALLS.test(callee)) break;
        if (method === 'charAt' || method === 'at' || method === 'codePointAt' || method === 'charCodeAt') break; // a character of a string
        if (HASH_CALLS.test(callee)) break; // hashing a predictable value keeps it predictable
        if (method === 'push' || method === 'unshift') {
          const target = unwrap((p.callee as { object?: Node }).object);
          if (target?.type === 'Identifier') return { kind: 'name', name: target.name, how: 'variable', node: p, parents: up };
          const path = memberPath(target);
          return path ? { kind: 'name', name: tailName(path), how: 'property', node: p, parents: up } : null;
        }
        if (/^set[A-Z]/.test(method) && argIndex === 0 && p.callee.type === 'Identifier') {
          return { kind: 'name', name: method.slice(3), how: 'setter', node: p, parents: up };
        }
        if (STORE_METHODS.has(method) && argIndex >= 1) {
          const key = stringValue(p.arguments[argIndex - 1] as Node);
          if (key) return { kind: 'name', name: key, how: 'storage', node: p, parents: up };
        }
        return null;
      }
      case 'NewExpression':
        return null;
      case 'BinaryExpression':
        if (['<', '>', '<=', '>=', '==', '===', '!=', '!==', 'instanceof', 'in'].includes(p.operator)) return null;
        break;
      case 'UnaryExpression':
        if (p.operator === '!' || p.operator === 'typeof' || p.operator === 'void' || p.operator === 'delete') return null;
        break;
      case 'ConditionalExpression':
        if (p.test === child) return null;
        break;
      case 'LogicalExpression':
      case 'TemplateLiteral':
      case 'ArrayExpression':
      case 'SpreadElement':
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'AwaitExpression':
        break;
      case 'SequenceExpression':
        if (p.expressions[p.expressions.length - 1] !== child) return null;
        break;
      case 'VariableDeclarator':
        if (p.init !== child || p.id.type !== 'Identifier') return null;
        return { kind: 'name', name: p.id.name, how: 'variable', node: p, parents: up };
      case 'AssignmentExpression': {
        if (p.right !== child) return null;
        if (p.left.type === 'Identifier') return { kind: 'name', name: p.left.name, how: 'variable', node: p, parents: up };
        const path = memberPath(p.left);
        return path ? { kind: 'name', name: tailName(path), how: 'property', node: p, parents: up } : null;
      }
      case 'ObjectProperty': {
        if (p.value !== child) return null;
        const key = keyName(p);
        if (!key) return null;
        return { kind: 'name', name: `${ownerName(parents, i) ?? ''} ${key}`.trim(), how: 'property', node: p, parents: up };
      }
      case 'ReturnStatement':
      case 'ArrowFunctionExpression': {
        if (p.type === 'ArrowFunctionExpression' && p.body !== child) return null;
        const fnIndex = p.type === 'ArrowFunctionExpression' ? i : functionIndex(parents, i);
        if (fnIndex < 0) return null;
        const fn = parents[fnIndex] as Node;
        const fnParents = parents.slice(0, fnIndex);
        const outer = fnParents[fnParents.length - 1];
        // A callback's return value flows into the call it is passed to: .replace(re, cb), Array.from(x, cb), .map(cb).
        if (outer && isCall(outer) && outer.arguments.includes(fn as never)) {
          child = outer;
          i = fnIndex - 1;
          continue;
        }
        return { kind: 'return', fn, name: functionName(fn, fnParents), node: p, parents: up };
      }
      default:
        return null;
    }
    child = p;
  }
  return null;
}

function functionIndex(parents: readonly Node[], from: number): number {
  for (let i = from; i >= 0; i--) if (isFunctionNode(parents[i] as Node)) return i;
  return -1;
}

/** `user.resetToken` -> 'user resetToken'; `this.state.token` -> 'state token'. */
function tailName(path: string): string {
  const parts = path.replace(/\(\)/g, '').split('.');
  return parts.slice(-2).join(' ');
}

/** The name an object literal is bound to, used to qualify bare keys: const invite = { code: ... }. */
function ownerName(parents: readonly Node[], propIndex: number): string | null {
  const obj = parents[propIndex - 1];
  const holder = parents[propIndex - 2];
  if (!obj || obj.type !== 'ObjectExpression' || !holder) return null;
  if (holder.type === 'VariableDeclarator' && holder.id.type === 'Identifier') return holder.id.name;
  if (holder.type === 'ObjectProperty') return keyName(holder);
  if (holder.type === 'AssignmentExpression') {
    const path = memberPath(holder.left);
    return path ? lastSegment(path) : null;
  }
  return null;
}

function isCharset(node: Node, parents: readonly Node[], w: Walker): boolean {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'StringLiteral' || n.type === 'TemplateLiteral') return true;
  if (n.type === 'Identifier' || n.type === 'MemberExpression') {
    const resolved = w.bindings.follow(n, parents);
    if (resolved && (resolved.type === 'StringLiteral' || resolved.type === 'TemplateLiteral')) return true;
    if (resolved && isCall(resolved)) {
      // 'abc...'.split('') or [...'abc']
      const callee = memberPath(resolved.callee);
      if (callee && /\.split$/.test(callee)) return true;
    }
    if (resolved?.type === 'ArrayExpression') {
      return resolved.elements.length > 0 && resolved.elements.every((e) => e?.type === 'StringLiteral' && e.value.length === 1) || resolved.elements.some((e) => e?.type === 'SpreadElement' && e.argument.type === 'StringLiteral');
    }
    const path = memberPath(n) ?? '';
    return CHARSET_NAME.test(lastSegment(path));
  }
  return false;
}

interface Hit {
  label: string;
  /** How the value is named at its destination: resetToken, generateToken(), setToken(), 'session_id'. */
  target: string;
  returned: boolean;
  /** Line of the destination (the credential-named variable, property, or return). */
  line: number;
  /** The neutral variable the value passed through first (result, code). */
  via?: { name: string };
}

/** `resetToken`, `otp (one-time password)`, `the value stored as 'session_id'`. */
function describe(hit: Hit): string {
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const named = compact(hit.target).includes(compact(hit.label));
  if (hit.target.startsWith("'")) return `the ${hit.label} stored as ${hit.target}`;
  if (hit.target.endsWith('()')) return `the ${hit.label} passed to ${hit.target}`;
  return named ? hit.target : `${hit.target} (${hit.label})`;
}

function article(label: string): string {
  return /^(API|HMAC|OAuth|[aeiou])/i.test(label) && !/^one/i.test(label) ? 'an' : 'a';
}

function capitalize(text: string): string {
  return text.startsWith('the ') ? `The ${text.slice(4)}` : text;
}

/** One sentence naming where the value goes and where Math.random() is. `helper` is set for values from a same-file helper. */
function messageFor(hit: Hit, helper?: { name: string; line: number }): string {
  const what = hit.returned ? `${article(hit.label)} ${hit.label}` : describe(hit);
  if (helper) {
    const from = `${helper.name}(), which builds it with Math.random() (line ${helper.line}), so it can be predicted.`;
    return hit.returned ? `${hit.target} returns ${what} from ${from}` : `${capitalize(what)} comes from ${from}`;
  }
  if (hit.via) {
    const dest = hit.returned ? `the ${hit.label} that ${hit.target} returns` : describe(hit);
    return `${hit.via.name} becomes ${dest} on line ${hit.line} but is generated with Math.random(), whose output can be predicted.`;
  }
  return hit.returned
    ? `${hit.target} returns ${what} built with Math.random(), whose output can be predicted.`
    : `${capitalize(what)} is generated with Math.random(), whose output can be predicted.`;
}

/** Where the value ends up, as a credential, following variables through up to two assignments. */
function credentialFor(landing: Landing | null, w: Walker, depth: number): Hit | null {
  if (!landing) return null;
  const line = landing.node.loc?.start.line ?? 1;
  if (landing.kind === 'return') {
    if (!landing.name) return null;
    const label = randomCredentialLabel(landing.name);
    if (!label && landing.name !== 'default' && landing.fn.type !== 'ClassMethod' && !isSampleName(landing.name)) w.returns.push(landing.name);
    return label ? { label, target: `${landing.name}()`, returned: true, line } : null;
  }
  const label = randomCredentialLabel(landing.name);
  if (label) {
    const bare = landing.name.includes(' ') ? (landing.name.split(' ').pop() as string) : landing.name;
    const target = landing.how === 'setter' ? `set${bare}()` : landing.how === 'storage' ? `'${bare}'` : bare;
    return { label, target, returned: false, line };
  }
  if (landing.how !== 'variable' || depth >= 2) return null;
  // A neutral variable (result, code, r): follow its uses in the same function.
  const scopeIndex = functionIndex(landing.parents, landing.parents.length - 1);
  const scope = scopeIndex >= 0 ? (landing.parents[scopeIndex] as Node) : (landing.parents[0] as Node | undefined);
  if (!scope) return null;
  const scopeParents = scopeIndex >= 0 ? landing.parents.slice(0, scopeIndex) : [];
  let found: Hit | null = null;
  walk(scope, {
    enter(node, rel) {
      if (found) return 'skip';
      if (node.type !== 'Identifier' || node.name !== landing.name) return undefined;
      const parent = rel[rel.length - 1];
      // Skip the declaration itself and non-value positions.
      if (!parent || (parent.type === 'VariableDeclarator' && parent.id === node) || (parent.type === 'AssignmentExpression' && parent.left === node)) return undefined;
      if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === node && !parent.computed) return undefined;
      if (parent.type === 'ObjectProperty' && parent.key === node && !parent.shorthand) return undefined;
      const next = land(node, [...scopeParents, ...rel], w);
      const hit = credentialFor(next, w, depth + 1);
      if (hit) found = { ...hit, via: { name: landing.name } };
      return undefined;
    },
  });
  return found;
}

export const weakTokenRandomness: Rule = {
  meta: {
    id: 'web/weak-token-randomness',
    level: 'block',
    scope: 'file',
    title: 'Credential generated with Math.random()',
    summary: 'Math.random() used to produce a token, session ID, password, one-time code, invite code, API key, nonce, salt, or secret.',
    why: 'Math.random() is not a cryptographic generator: its output can be predicted from earlier values, so tokens built from it can be guessed. Password reset tokens, session IDs, and one-time codes built this way let an attacker take over accounts.',
    fix: 'Generate the value with crypto.randomBytes() or crypto.randomUUID() in Node, or crypto.getRandomValues() in the browser.',
    cwe: ['CWE-330', 'CWE-338'],
    owasp: ['A04:2025'],
    levels: 'block; warn for a bare token, session ID, or nonce outside server code, request handlers, and auth files or functions (markers, CLI session names, chat IDs, temp file names), and in example, sample, and demo folders.',
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test') && !SAMPLE_FILE.test(file.path),
  js(ctx) {
    let bindings: Bindings | null = null;
    const walker = (): Walker => {
      bindings ??= new Bindings(ctx.program.program);
      return { bindings, returns: [] };
    };
    /** Same-file helpers that return a Math.random() value under a neutral name (randomString, makeid). */
    const helpers = new Map<string, number>();
    const reported = new Set<string>();
    /**
     * A bare token, a session ID, or a nonce is a credential in server code, request handlers, auth
     * files, and auth functions, and when it is stored as a cookie, header, or storage value; elsewhere
     * (a CLI, a chat UI, a temp-file helper, a message correlation ID) it is often a plain marker, so
     * it is warn there. Example folders are warn.
     */
    const authPath = AUTH_PATH.test(ctx.file.path);
    const levelFor = (hit: Hit, parents: readonly Node[]) => {
      if (!isContextualCredential(hit.label)) return exampleLevel(ctx.file);
      const except = hit.returned ? hit.target.replace(/\(\)$/, '') : null;
      const credentialContext = ctx.file.server || authPath || hit.target.charAt(0) === "'" || inRequestHandler(parents) || inAuthFunction(parents, except);
      return credentialContext ? exampleLevel(ctx.file) : 'warn';
    };
    const once = (line: number, hit: Hit) => {
      const k = `${line}:${hit.target}`;
      if (reported.has(k)) return false;
      reported.add(k);
      return true;
    };
    return {
      CallExpression(node) {
        if (memberPath(node.callee) !== 'Math.random') return;
        if (inSampleFunction(ctx.parents)) return;
        const w = walker();
        const hit = credentialFor(land(node, ctx.parents, w), w, 0);
        if (hit) {
          if (once(node.loc?.start.line ?? 1, hit)) ctx.report(node, { message: messageFor(hit), key: hit.target, level: levelFor(hit, ctx.parents) });
          return;
        }
        for (const name of w.returns) if (!helpers.has(name)) helpers.set(name, node.loc?.start.line ?? 1);
      },
      'Program:exit'() {
        if (helpers.size === 0) return;
        const w = walker();
        walk(ctx.program.program, {
          enter(node, parents) {
            if (!isCall(node) || node.callee.type !== 'Identifier') return undefined;
            const line = helpers.get(node.callee.name);
            if (line === undefined || inSampleFunction(parents)) return undefined;
            const hit = credentialFor(land(node, parents, w), w, 0);
            if (!hit) return undefined;
            if (!once(node.loc?.start.line ?? 1, hit)) return undefined;
            ctx.report(node, {
              level: levelFor(hit, parents),
              message: messageFor({ ...hit, via: undefined }, { name: node.callee.name, line }),
              key: hit.target,
              trace: [
                { line, note: `Math.random() in ${node.callee.name}()` },
                { line: node.loc?.start.line ?? 1, note: `result used as ${hit.target}` },
              ],
            });
            return undefined;
          },
        });
      },
    };
  },
};
