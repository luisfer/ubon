import type { Node } from '@babel/types';
import { keyName, memberPath, propertyName, unwrap } from '../../lang/js.ts';
import type { Rule } from '../types.ts';
import { Bindings, isCall, lastSegment, staticString, templateShape } from './pattern-ast.ts';
import { storageCredentialLabel } from './pattern-names.ts';

/**
 * Auth tokens written to localStorage or sessionStorage. Any script that runs
 * on the page (an XSS bug, a compromised dependency, a browser extension) can
 * read web storage, while an httpOnly cookie is out of reach of scripts. The
 * key or the stored value must be named like an auth credential; `theme`,
 * `locale`, `sidebar`, chat sessions, and token counts never match.
 */

const STORAGE = /^(?:(?:window|globalThis|self)\.){0,2}(localStorage|sessionStorage)$/;
const HOOKS = new Set(['useLocalStorage', 'useSessionStorage', 'useLocalStorageState', 'useSessionStorageState', 'useStorageState']);

/** A readable name for a storage key expression, following same-file constants: TOKEN_KEY -> 'auth_token' or TOKEN. */
function keyText(node: Node, bindings: Bindings, parents: readonly Node[]): { text: string; literal: boolean } | null {
  const value = staticString(node, bindings, parents);
  if (value !== null) return { text: value, literal: true };
  const shape = templateShape(node);
  if (shape) return { text: shape.text.replace(/\u0000/g, ' '), literal: true };
  const path = memberPath(node);
  if (!path || path.endsWith(')')) return null;
  // Constants named after the thing they store: TOKEN_KEY, AUTH_TOKEN_STORAGE_KEY, STORAGE_KEYS.ACCESS_TOKEN.
  const name = lastSegment(path).replace(/(_?STORAGE)?(_?KEY|_?NAME|Key|Name)$/, '');
  return name ? { text: name, literal: false } : null;
}

/** The credential a stored value is named after: token, data.access_token, JSON.stringify({ token }), getToken(). */
function valueLabel(node: Node | null | undefined, depth = 0): { label: string; name: string } | null {
  const n = unwrap(node);
  if (!n || depth > 3) return null;
  if (n.type === 'Identifier') {
    const label = storageCredentialLabel(n.name);
    return label ? { label, name: n.name } : null;
  }
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
    const prop = propertyName(n);
    const label = prop ? storageCredentialLabel(prop) : null;
    return label ? { label, name: memberPath(n) ?? (prop as string) } : null;
  }
  if (isCall(n)) {
    const callee = memberPath(n.callee) ?? '';
    if (callee === 'JSON.stringify' || callee === 'String' || callee === 'btoa' || callee === 'encodeURIComponent') return valueLabel(n.arguments[0] as Node, depth + 1);
    const method = lastSegment(callee);
    if (/^(get|read|load|fetch)[A-Z]/.test(method)) {
      const label = storageCredentialLabel(method.replace(/^(get|read|load|fetch)/, ''));
      return label ? { label, name: `${callee}()` } : null;
    }
    return null;
  }
  if (n.type === 'ObjectExpression') {
    for (const p of n.properties) {
      if (p.type !== 'ObjectProperty') continue;
      const key = keyName(p);
      const label = key ? storageCredentialLabel(key) : null;
      if (label) return { label, name: key as string };
    }
    return null;
  }
  if (n.type === 'TemplateLiteral') {
    for (const e of n.expressions) {
      const hit = valueLabel(e as Node, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function article(label: string): string {
  return /^(API|ID|[aeiou])/i.test(label) ? 'an' : 'a';
}

export const tokenInWebStorage: Rule = {
  meta: {
    id: 'web/token-in-web-storage',
    level: 'warn',
    scope: 'file',
    title: 'Auth token in localStorage or sessionStorage',
    summary: 'localStorage or sessionStorage used to store a value named like an auth credential (token, accessToken, refreshToken, jwt, session, apiKey, password).',
    why: 'Every script on the page can read web storage, so one XSS bug or compromised dependency is enough to steal the token and use it elsewhere. An httpOnly cookie keeps the token out of reach of scripts.',
    fix: 'Keep the session in an httpOnly, secure cookie set by the server, or hold the token in memory only.',
    cwe: ['CWE-922'],
    owasp: ['A07:2025'],
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test'),
  js(ctx) {
    let bindings: Bindings | null = null;
    const b = () => (bindings ??= new Bindings(ctx.program.program));

    const check = (node: Node, storage: string, keyNode: Node | null, value: Node | null) => {
      const key = keyNode ? keyText(keyNode, b(), ctx.parents) : null;
      const keyLabel = key ? storageCredentialLabel(key.text) : null;
      const fromValue = keyLabel ? null : valueLabel(value);
      const label = keyLabel ?? fromValue?.label;
      if (!label) return;
      const where = key?.literal ? ` under '${key.text}'` : '';
      const what = fromValue ? `${fromValue.name} (${article(label)} ${label})` : `${article(label)} ${label}`;
      ctx.report(node, {
        message: `${storage} stores ${what}${where}, where any script on the page can read it.`,
        key: key?.text ?? fromValue?.name ?? label,
      });
    };

    return {
      CallExpression(node) {
        const callee = node.callee as Node;
        if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
          if (propertyName(callee) !== 'setItem') return;
          const m = STORAGE.exec(memberPath(callee.object) ?? '');
          if (!m) return;
          check(node, m[1] as string, (node.arguments[0] as Node) ?? null, (node.arguments[1] as Node) ?? null);
          return;
        }
        if (callee.type === 'Identifier' && HOOKS.has(callee.name)) {
          const first = unwrap(node.arguments[0] as Node);
          const keyNode = first?.type === 'ObjectExpression' ? (first.properties.find((p) => p.type === 'ObjectProperty' && keyName(p) === 'key') as { value: Node } | undefined)?.value ?? null : first;
          if (!keyNode) return;
          const key = keyText(keyNode, b(), ctx.parents);
          const label = key?.literal ? storageCredentialLabel(key.text) : null;
          if (!label || !key) return;
          const storage = /Session/.test(callee.name) ? 'sessionStorage' : 'localStorage';
          ctx.report(node, {
            message: `${callee.name}() keeps ${article(label)} ${label} in ${storage} under '${key.text}', where any script on the page can read it.`,
            key: key.text,
          });
        }
      },
      AssignmentExpression(node) {
        // localStorage.token = t, localStorage['access_token'] = t
        const left = node.left as Node;
        if (left.type !== 'MemberExpression' || node.operator !== '=') return;
        const m = STORAGE.exec(memberPath(left.object) ?? '');
        if (!m) return;
        const keyNode: Node | null = left.computed ? (left.property as Node) : { type: 'StringLiteral', value: propertyName(left) ?? '' } as Node;
        check(node, m[1] as string, keyNode, node.right as Node);
      },
    };
  },
};
