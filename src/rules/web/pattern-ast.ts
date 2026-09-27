import type { Node, VariableDeclarator } from '@babel/types';
import { keyName, memberPath, propertyName, stringValue, unwrap } from '../../lang/js.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';

/**
 * AST helpers for the pattern rules in this pack (and llm/browser-key):
 * resolving a name to its declaration in the same file, reading environment
 * variables, naming functions, and listing the calls inside a function.
 */

/** Block findings in example, sample, demo, and template folders are warn: that code shows a pattern and is not deployed as is. */
export function exampleLevel(file: { contexts: ReadonlySet<string> }): 'block' | 'warn' {
  return file.contexts.has('example') ? 'warn' : 'block';
}

export function isCall(node: Node | null | undefined): node is Node & { type: 'CallExpression' | 'OptionalCallExpression'; callee: Node; arguments: Node[] } {
  return !!node && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression');
}

/** Last segment of a callee: `stripe.webhooks.constructEvent` -> constructEvent. */
export function lastSegment(path: string | null): string {
  if (!path) return '';
  const clean = path.replace(/\(\)/g, '');
  const i = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf('#'));
  return i >= 0 ? clean.slice(i + 1) : clean;
}

/** The name a function is known by: its own id, the variable, property, or export it is assigned to. */
export function functionName(fn: Node, parents: readonly Node[]): string | null {
  const f = fn as { id?: Node | null; key?: Node; type: string };
  if ((fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') && f.id?.type === 'Identifier') return f.id.name;
  if (fn.type === 'ObjectMethod' || fn.type === 'ClassMethod' || fn.type === 'ClassPrivateMethod') return keyName(fn) ?? (f.key?.type === 'PrivateName' ? f.key.id.name : null);
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type === 'VariableDeclarator') return p.id.type === 'Identifier' ? p.id.name : null;
    if (p.type === 'ObjectProperty' || p.type === 'ClassProperty') return keyName(p);
    if (p.type === 'AssignmentExpression') {
      const path = memberPath(p.left);
      return path ? lastSegment(path) : null;
    }
    if (p.type === 'ExportDefaultDeclaration') return 'default';
    // Wrappers such as `export const POST = withAuth(async (req) => ...)` name the inner function too.
    if (isCall(p) || p.type === 'TSAsExpression' || p.type === 'TSSatisfiesExpression' || p.type === 'ParenthesizedExpression' || p.type === 'AwaitExpression') continue;
    return null;
  }
  return null;
}

/** Environment variable name read by an expression: process.env.X, import.meta.env.X, Deno.env.get('X'), Bun.env.X. */
export function envName(node: Node | null | undefined, bindings?: Bindings, parents?: readonly Node[], depth = 0): string | null {
  const n = unwrap(node);
  if (!n || depth > 4) return null;
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
    const path = memberPath(n);
    if (path) {
      const m = /^(?:process\.env|import\.meta\.env|Bun\.env|globalThis\.process\.env)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(path);
      if (m) return m[1] as string;
      // Runtime config the server writes into the page (window.ENV in Remix): the full path, so callers can tell it is public.
      if (/^(?:window|globalThis|self)\.(?:env|ENV|__env|__ENV|__ENV__|_env_)\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return path;
      // const env = import.meta.env; env.VITE_KEY
      const head = path.split('.')[0] as string;
      if (bindings && parents && head !== path && path.split('.').length === 2) {
        if (head === 'this') {
          const field = bindings.field(path);
          if (field) return envName(field, bindings, parents, depth + 1);
        }
        const init = bindings.resolve(head, parents);
        const initPath = init ? memberPath(init) : null;
        if (initPath && /^(process\.env|import\.meta\.env|Bun\.env)$/.test(initPath)) return lastSegment(path);
      }
    }
    return null;
  }
  if (isCall(n)) {
    const callee = memberPath(n.callee);
    if (callee === 'Deno.env.get' || callee === 'env.get' || callee === 'Netlify.env.get') return stringValue(n.arguments[0] as Node);
    return null;
  }
  if (n.type === 'Identifier' && bindings && parents) {
    const init = bindings.resolve(n.name, parents);
    if (init && init !== n) return envName(init, undefined, undefined);
  }
  return null;
}

/** Env reads anywhere inside an expression (templates, concatenation, fallbacks, same-file constants and helpers). */
export function envNamesIn(node: Node | null | undefined, bindings?: Bindings, parents?: readonly Node[]): string[] {
  const n = unwrap(node);
  if (!n) return [];
  const direct = envName(n, bindings, parents);
  if (direct) return [direct];
  const out: string[] = [];
  const visit = (x: Node | null | undefined, depth: number, scope: readonly Node[] | undefined): void => {
    const u = unwrap(x);
    if (!u || depth > 8) return;
    const name = envName(u, bindings, scope);
    if (name) {
      out.push(name);
      return;
    }
    switch (u.type) {
      case 'TemplateLiteral':
        for (const e of u.expressions) visit(e as Node, depth + 1, scope);
        break;
      case 'BinaryExpression':
        visit(u.left as Node, depth + 1, scope);
        visit(u.right, depth + 1, scope);
        break;
      case 'LogicalExpression':
        visit(u.left, depth + 1, scope);
        visit(u.right, depth + 1, scope);
        break;
      case 'ConditionalExpression':
        visit(u.consequent, depth + 1, scope);
        visit(u.alternate, depth + 1, scope);
        break;
      case 'CallExpression':
      case 'OptionalCallExpression': {
        // String(x), x.trim(), x?.trim(), `${x}`.toString()
        const callee = u.callee as Node;
        if (callee.type === 'Identifier' && callee.name === 'String') visit(u.arguments[0] as Node, depth + 1, scope);
        else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') visit(callee.object as Node, depth + 1, scope);
        else if (callee.type === 'Identifier' && bindings && depth < 6) {
          // Same-file helpers: getApiKey() returns the env value, validateKey(key) returns its argument.
          for (const r of bindings.returnsOf(callee.name)) {
            if (r.param !== null) visit(u.arguments[r.param] as Node, depth + 1, scope);
            else visit(r.expr, depth + 1, [r.fn]);
          }
        }
        break;
      }
      case 'Identifier':
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        // const KEY = import.meta.env.VITE_KEY?.trim(); this.apiKey = KEY
        if (!bindings || depth > 6) break;
        const path = memberPath(u);
        if (u.type !== 'Identifier' && path?.startsWith('this.')) {
          for (const value of bindings.fieldValues(path)) visit(value, depth + 1, scope);
          break;
        }
        const next = u.type === 'Identifier' ? bindings.follow(u, scope ?? []) : null;
        if (next && next !== u) visit(next, depth + 1, scope);
        break;
      }
      default:
        break;
    }
  };
  visit(n, 0, parents);
  return out;
}

interface BindingEntry {
  decl: VariableDeclarator;
  /** The function the declaration is in, or null at module level. */
  scope: Node | null;
  /** For `const { a } = obj`: the property read from the init. */
  property?: string;
}

/**
 * Declarations by name, so a rule can resolve an identifier to the expression
 * it was initialized with. Scoping is approximate: the nearest declaration in
 * the current function or an enclosing one wins, then module level.
 */
export class Bindings {
  private readonly map = new Map<string, BindingEntry[]>();
  /** `this.x = init` assignments and class fields, by `this.x`. */
  private readonly fields = new Map<string, Node[]>();
  /** Module-level functions by name. */
  private readonly functions = new Map<string, Node>();

  constructor(program: Node) {
    const stack: Node[] = [];
    walk(program, {
      enter: (node, parents) => {
        if (isFunctionNode(node)) {
          stack.push(node);
          const parent = parents[parents.length - 1];
          const name = node.type === 'FunctionDeclaration' ? (node.id?.name ?? null) : parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : null;
          if (name && stack.length === 1 && !this.functions.has(name)) this.functions.set(name, node);
        }
        if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'MemberExpression' && node.left.object.type === 'ThisExpression') {
          const path = memberPath(node.left);
          if (path) this.addField(path, node.right);
        }
        if ((node.type === 'ClassProperty' || node.type === 'ClassPrivateProperty') && node.value) {
          const key = node.type === 'ClassProperty' ? keyName(node) : null;
          if (key) this.addField(`this.${key}`, node.value as Node);
        }
        if (node.type === 'VariableDeclarator') {
          const scope = stack.length > 0 ? (stack[stack.length - 1] as Node) : null;
          if (node.id.type === 'Identifier') this.add(node.id.name, { decl: node, scope });
          else if (node.id.type === 'ObjectPattern') {
            for (const p of node.id.properties) {
              if (p.type !== 'ObjectProperty') continue;
              const value = p.value.type === 'AssignmentPattern' ? p.value.left : p.value;
              const key = keyName(p);
              if (value.type === 'Identifier' && key) this.add(value.name, { decl: node, scope, property: key });
            }
          }
        }
        return undefined;
      },
      exit: (node) => {
        if (isFunctionNode(node)) stack.pop();
      },
    });
  }

  private addField(path: string, value: Node): void {
    const u = unwrap(value);
    // `= null` and `= undefined` initializers say nothing about the value.
    if (!u || u.type === 'NullLiteral' || (u.type === 'Identifier' && u.name === 'undefined')) return;
    const list = this.fields.get(path) ?? [];
    list.push(value);
    this.fields.set(path, list);
  }

  private add(name: string, entry: BindingEntry): void {
    const list = this.map.get(name) ?? [];
    list.push(entry);
    this.map.set(name, list);
  }

  entry(name: string, parents: readonly Node[]): BindingEntry | null {
    const list = this.map.get(name);
    if (!list || list.length === 0) return null;
    for (let i = parents.length - 1; i >= 0; i--) {
      const p = parents[i] as Node;
      if (!isFunctionNode(p)) continue;
      const hit = list.filter((e) => e.scope === p);
      if (hit.length > 0) return hit[hit.length - 1] as BindingEntry;
    }
    const top = list.filter((e) => e.scope === null);
    return top.length > 0 ? (top[top.length - 1] as BindingEntry) : null;
  }

  /** The init expression of the nearest declaration of `name` (the property read for destructuring is not applied). */
  resolve(name: string, parents: readonly Node[]): Node | null {
    const e = this.entry(name, parents);
    if (!e || e.property) return null;
    return (e.decl.init as Node | null) ?? null;
  }

  /** Follow identifiers (and `this.x` fields) to their initializers, up to a few steps: const a = b; const b = 'x'. */
  follow(node: Node | null | undefined, parents: readonly Node[]): Node | null {
    let n = unwrap(node);
    for (let i = 0; i < 4 && n; i++) {
      let next: Node | null = null;
      if (n.type === 'Identifier') next = this.resolve(n.name, parents);
      else if (n.type === 'MemberExpression' && n.object.type === 'ThisExpression') next = this.field(memberPath(n) ?? '');
      if (!next) break;
      n = unwrap(next);
    }
    return n;
  }

  /** The first value assigned to `this.x` in the file (constructor or class field), or null. */
  field(path: string): Node | null {
    return this.fields.get(path)?.[0] ?? null;
  }

  /** Every value assigned to `this.x` in the file. */
  fieldValues(path: string): readonly Node[] {
    return this.fields.get(path) ?? [];
  }

  /**
   * What a module-level function returns: each return expression, or the index of the
   * parameter it returns unchanged (`validateKey(key) { ...; return key }`).
   */
  returnsOf(name: string): Array<{ expr: Node; param: number | null; fn: Node }> {
    const fn = this.functions.get(name) as (Node & { params: Node[]; body: Node }) | undefined;
    if (!fn) return [];
    const params = fn.params.map((p) => (p.type === 'Identifier' ? p.name : p.type === 'AssignmentPattern' && p.left.type === 'Identifier' ? p.left.name : null));
    const exprs: Node[] = [];
    if (fn.body.type !== 'BlockStatement') exprs.push(fn.body);
    else {
      walk(fn.body, {
        enter(node) {
          if (node !== fn.body && isFunctionNode(node)) return 'skip';
          if (node.type === 'ReturnStatement' && node.argument) exprs.push(node.argument as Node);
          return undefined;
        },
      });
    }
    return exprs.slice(0, 6).map((expr) => {
      const u = unwrap(expr);
      const index = u?.type === 'Identifier' ? params.indexOf(u.name) : -1;
      return { expr, param: index >= 0 ? index : null, fn };
    });
  }
}

/** A static string, following same-file constants: 'x', `x`, NAME where const NAME = 'x'. */
export function staticString(node: Node | null | undefined, bindings: Bindings, parents: readonly Node[]): string | null {
  const direct = stringValue(node);
  if (direct !== null) return direct;
  const n = bindings.follow(node, parents);
  if (n && n !== unwrap(node)) {
    const v = stringValue(n);
    if (v !== null) return v;
  }
  // COOKIE_NAMES.session where const COOKIE_NAMES = { session: 'sid' }
  const u = unwrap(node);
  if (u && (u.type === 'MemberExpression' || u.type === 'OptionalMemberExpression')) {
    const prop = propertyName(u);
    const obj = bindings.follow(u.object, parents);
    if (prop && obj?.type === 'ObjectExpression') {
      for (const p of obj.properties) {
        if (p.type === 'ObjectProperty' && keyName(p) === prop) return stringValue(p.value as Node);
      }
    }
  }
  return null;
}

/** The static text of a template or string, with `${}` parts replaced by a marker. */
export function templateShape(node: Node | null | undefined): { text: string; dynamic: boolean } | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === 'StringLiteral') return { text: n.value, dynamic: false };
  if (n.type === 'TemplateLiteral') {
    let text = '';
    n.quasis.forEach((q, i) => {
      text += q.value.cooked ?? q.value.raw;
      if (i < n.expressions.length) text += '\u0000';
    });
    return { text, dynamic: n.expressions.length > 0 };
  }
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const left = templateShape(n.left as Node) ?? { text: '\u0000', dynamic: true };
    const right = templateShape(n.right) ?? { text: '\u0000', dynamic: true };
    return { text: left.text + right.text, dynamic: left.dynamic || right.dynamic };
  }
  return null;
}

/** Every call inside a node, including nested functions unless `shallow`. */
export function callsIn(root: Node, shallow = false): Array<Node & { callee: Node; arguments: Node[] }> {
  const out: Array<Node & { callee: Node; arguments: Node[] }> = [];
  walk(root, {
    enter(node) {
      if (shallow && node !== root && isFunctionNode(node)) return 'skip';
      if (isCall(node) || node.type === 'NewExpression') out.push(node as Node & { callee: Node; arguments: Node[] });
      return undefined;
    },
  });
  return out;
}

/** Identifier names used anywhere inside a node. */
export function identifiersIn(root: Node | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!root) return out;
  walk(root, {
    enter(node) {
      if (node.type === 'Identifier') out.add(node.name);
      return undefined;
    },
  });
  return out;
}

/** True when the node is inside the consequent of a development-only branch (NODE_ENV === 'development', isDev, import.meta.env.DEV). */
export function inDevelopmentBranch(node: Node, parents: readonly Node[]): boolean {
  let child: Node = node;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type === 'IfStatement' || p.type === 'ConditionalExpression') {
      const dev = developmentTest(p.test);
      if (dev === 'dev' && p.consequent === child) return true;
      if (dev === 'prod' && p.alternate === child) return true;
    }
    child = p;
  }
  return false;
}

function developmentTest(test: Node): 'dev' | 'prod' | null {
  const t = unwrap(test);
  if (!t) return null;
  if (t.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(t.operator)) {
    const sides = [t.left as Node, t.right];
    const env = sides.some((s) => memberPath(s) === 'process.env.NODE_ENV' || memberPath(s) === 'import.meta.env.MODE');
    const value = sides.map((s) => stringValue(s)).find((v) => v !== null);
    if (!env || !value) return null;
    const isDev = /^(development|dev|test|local)$/.test(value);
    const isProd = value === 'production';
    const negated = t.operator.startsWith('!');
    if (isDev) return negated ? 'prod' : 'dev';
    if (isProd) return negated ? 'dev' : 'prod';
    return null;
  }
  const path = memberPath(t);
  if (path && /^(isDev|isDevelopment|dev|IS_DEV|import\.meta\.env\.DEV|__DEV__)$/.test(path)) return 'dev';
  if (path && /^(isProd|isProduction|IS_PROD|import\.meta\.env\.PROD)$/.test(path)) return 'prod';
  if (t.type === 'UnaryExpression' && t.operator === '!') {
    const inner = developmentTest(t.argument);
    return inner === 'dev' ? 'prod' : inner === 'prod' ? 'dev' : null;
  }
  return null;
}
