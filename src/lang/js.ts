import type {
  CallExpression,
  Expression,
  File as BabelFile,
  Function as FunctionNode,
  LVal,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  PatternLike,
  VariableDeclarator,
} from '@babel/types';
import { isFunctionNode } from './walk.ts';

/**
 * JavaScript helpers shared by rules: member paths, literal values, import
 * aliases, and a small intra-function taint tracker.
 *
 * Taint is deliberately simple. Sources are request data, model output, and
 * network responses. Values flow through local bindings, destructuring,
 * templates, concatenation, and a fixed list of pass-through functions. Unknown
 * function calls end the flow, which trades some missed findings for precision.
 */

// ---------------------------------------------------------------------------
// Basic helpers

export function unwrap(node: Node | null | undefined): Node | null {
  let n = node ?? null;
  while (
    n &&
    (n.type === 'TSAsExpression' ||
      n.type === 'TSNonNullExpression' ||
      n.type === 'TSSatisfiesExpression' ||
      n.type === 'TSTypeAssertion' ||
      n.type === 'ParenthesizedExpression' ||
      n.type === 'TypeCastExpression' ||
      n.type === 'AwaitExpression')
  ) {
    n = (n as { expression?: Node; argument?: Node }).expression ?? (n as { argument?: Node }).argument ?? null;
  }
  return n;
}

/** 'a.b.c' for identifiers and member chains with static keys, else null. */
export function memberPath(node: Node | null | undefined): string | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'ThisExpression') return 'this';
  if (n.type === 'Super') return 'super';
  if (n.type === 'MetaProperty') return `${n.meta.name}.${n.property.name}`;
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
    const object = memberPath(n.object);
    if (object === null) return null;
    const prop = propertyName(n);
    return prop === null ? null : `${object}.${prop}`;
  }
  if (n.type === 'CallExpression' || n.type === 'OptionalCallExpression') {
    const callee = memberPath(n.callee);
    return callee === null ? null : `${callee}()`;
  }
  if (n.type === 'NewExpression') {
    const callee = memberPath(n.callee);
    return callee === null ? null : `new ${callee}()`;
  }
  return null;
}

export function propertyName(member: Node): string | null {
  const m = member as { computed?: boolean; property?: Node };
  const prop = m.property;
  if (!prop) return null;
  if (!m.computed && prop.type === 'Identifier') return prop.name;
  if (prop.type === 'PrivateName') return `#${prop.id.name}`;
  if (prop.type === 'StringLiteral') return prop.value;
  if (prop.type === 'NumericLiteral') return String(prop.value);
  return null;
}

export function keyName(prop: ObjectProperty | Node): string | null {
  const p = prop as { key?: Node; computed?: boolean };
  const key = p.key;
  if (!key) return null;
  if (key.type === 'Identifier' && !p.computed) return key.name;
  if (key.type === 'StringLiteral') return key.value;
  if (key.type === 'NumericLiteral') return String(key.value);
  return null;
}

/** Static string value of a literal or a template without expressions. */
export function stringValue(node: Node | null | undefined): string | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  return null;
}

export function isConstantExpression(node: Node | null | undefined): boolean {
  const n = unwrap(node);
  if (!n) return true;
  switch (n.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
    case 'RegExpLiteral':
      return true;
    case 'TemplateLiteral':
      return n.expressions.every((e) => isConstantExpression(e));
    case 'BinaryExpression':
      return isConstantExpression(n.left) && isConstantExpression(n.right);
    case 'UnaryExpression':
      return isConstantExpression(n.argument);
    case 'Identifier':
      return n.name === 'undefined';
    default:
      return false;
  }
}

export function objectProp(obj: ObjectExpression | Node | null | undefined, name: string): Node | null {
  const o = unwrap(obj);
  if (!o || o.type !== 'ObjectExpression') return null;
  for (const p of o.properties) {
    if ((p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && keyName(p) === name) {
      return p.type === 'ObjectProperty' ? (p.value as Node) : p;
    }
  }
  return null;
}

export function boolValue(node: Node | null | undefined): boolean | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === 'BooleanLiteral') return n.value;
  if (n.type === 'StringLiteral') return n.value === 'true' ? true : n.value === 'false' ? false : null;
  return null;
}

export function lineOf(node: Node): number {
  return node.loc?.start.line ?? 1;
}

export function bindingNames(pattern: LVal | PatternLike | Node | null | undefined): string[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name];
    case 'ObjectPattern':
      return pattern.properties.flatMap((p) => (p.type === 'RestElement' ? bindingNames(p.argument) : bindingNames(p.value as Node)));
    case 'ArrayPattern':
      return pattern.elements.flatMap((e) => bindingNames(e));
    case 'AssignmentPattern':
      return bindingNames(pattern.left);
    case 'RestElement':
      return bindingNames(pattern.argument);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Imports and canonical callee names

export interface ImportBinding {
  module: string;
  /** 'default', '*', or the imported name. */
  imported: string;
}

export function normalizeModule(spec: string): string {
  let m = spec.replace(/^node:/, '');
  if (m === 'fs/promises') m = 'fs';
  if (m === 'child_process/promises') m = 'child_process';
  if (m === 'timers/promises') m = 'timers';
  return m;
}

export class ImportMap {
  readonly bindings = new Map<string, ImportBinding>();
  /** Local names bound to another canonical name, e.g. const pexec = promisify(exec). */
  readonly aliases = new Map<string, string>();

  constructor(file: BabelFile) {
    for (const stmt of file.program.body) {
      if (stmt.type === 'ImportDeclaration') {
        const module = normalizeModule(stmt.source.value);
        for (const spec of stmt.specifiers) {
          if (spec.type === 'ImportDefaultSpecifier') this.bindings.set(spec.local.name, { module, imported: 'default' });
          else if (spec.type === 'ImportNamespaceSpecifier') this.bindings.set(spec.local.name, { module, imported: '*' });
          else {
            const imported = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
            this.bindings.set(spec.local.name, { module, imported });
          }
        }
      } else if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations) this.recordRequire(decl);
      }
    }
  }

  /** const x = require('m'), const { a } = require('m'), const b = promisify(a) */
  recordRequire(decl: VariableDeclarator): void {
    const init = unwrap(decl.init);
    if (!init) return;
    if (init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'require') {
      const mod = stringValue(init.arguments[0] as Node);
      if (!mod) return;
      const module = normalizeModule(mod);
      if (decl.id.type === 'Identifier') this.bindings.set(decl.id.name, { module, imported: '*' });
      else if (decl.id.type === 'ObjectPattern') {
        for (const p of decl.id.properties) {
          if (p.type === 'ObjectProperty' && p.value.type === 'Identifier') {
            const imported = keyName(p);
            if (imported) this.bindings.set(p.value.name, { module, imported });
          }
        }
      }
      return;
    }
    if (init.type === 'MemberExpression' && decl.id.type === 'Identifier') {
      // const exec = require('child_process').exec
      const obj = unwrap(init.object);
      if (obj?.type === 'CallExpression' && obj.callee.type === 'Identifier' && obj.callee.name === 'require') {
        const mod = stringValue(obj.arguments[0] as Node);
        const prop = propertyName(init);
        if (mod && prop) this.bindings.set(decl.id.name, { module: normalizeModule(mod), imported: prop });
      }
      return;
    }
    if (init.type === 'CallExpression' && decl.id.type === 'Identifier') {
      const callee = this.canonical(init.callee);
      if ((callee === 'util#promisify' || callee === 'promisify') && init.arguments[0]) {
        const target = this.canonical(init.arguments[0] as Node);
        if (target) this.aliases.set(decl.id.name, target);
      }
    }
    if (decl.id.type === 'ObjectPattern' && init.type !== 'CallExpression') {
      // const { exec } = cp  where cp is an imported module
      const base = memberPath(init);
      const binding = base ? this.bindings.get(base) : undefined;
      if (binding && binding.imported === '*') {
        for (const p of decl.id.properties) {
          if (p.type === 'ObjectProperty' && p.value.type === 'Identifier') {
            const imported = keyName(p);
            if (imported) this.bindings.set(p.value.name, { module: binding.module, imported });
          }
        }
      }
    }
  }

  /**
   * Canonical name of a callee: "module#export.path" for imported bindings
   * (child_process#exec, fs#readFile), otherwise the dotted source text
   * (fetch, res.redirect, prisma.$queryRawUnsafe).
   */
  canonical(node: Node | null | undefined): string | null {
    const path = memberPath(node);
    if (!path) return null;
    const [head, ...rest] = path.split('.');
    if (!head) return null;
    const alias = this.aliases.get(head);
    if (alias) return rest.length ? `${alias}.${rest.join('.')}` : alias;
    const binding = this.bindings.get(head);
    if (!binding) return path;
    const tail = rest.join('.').replace(/^promises\./, '');
    if (binding.imported === '*' || binding.imported === 'default') {
      return tail ? `${binding.module}#${tail}` : `${binding.module}#${binding.imported === '*' ? '*' : 'default'}`;
    }
    return tail ? `${binding.module}#${binding.imported}.${tail}` : `${binding.module}#${binding.imported}`;
  }

  importsModule(re: RegExp): boolean {
    for (const b of this.bindings.values()) if (re.test(b.module)) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Taint

export type TaintKind = 'request' | 'model' | 'external';

export interface Taint {
  kind: TaintKind;
  /** Human description of the source, e.g. "request body". */
  source: string;
  line: number;
  /** Functions the value passed through, lowercased (for sanitizer checks). */
  via: string[];
  /** For template strings: true when the tainted part comes after a fixed scheme and host. */
  pathOnly?: boolean;
}

type Binding = { taint: Taint | null; requestObject?: boolean; modelObject?: boolean };

interface Scope {
  vars: Map<string, Binding>;
  parent: Scope | null;
  fn: FunctionNode | null;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']);
const REQUEST_PROPS = new Set(['body', 'query', 'params', 'headers', 'cookies', 'files', 'file', 'rawBody', 'url', 'nextUrl', 'searchParams', 'originalUrl', 'path', 'hostname', 'formData']);
const REQUEST_METHODS = new Set(['json', 'formData', 'text', 'arrayBuffer', 'blob', 'query', 'queries', 'param', 'header', 'parseBody', 'valid']);
const PASS_THROUGH_METHODS = new Set([
  'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'toString', 'slice', 'substring', 'substr', 'split', 'join', 'replace',
  'replaceAll', 'concat', 'at', 'get', 'getAll', 'padStart', 'padEnd', 'normalize', 'valueOf', 'map', 'filter', 'find', 'flat', 'entries', 'values', 'keys',
]);
const PASS_THROUGH_FUNCTIONS = new Set([
  'String', 'decodeURIComponent', 'decodeURI', 'unescape', 'atob', 'JSON.parse', 'Object.fromEntries', 'Object.assign', 'Array.from', 'Buffer.from',
  'path#join', 'path#resolve', 'path#normalize', 'path.join', 'path.resolve', 'path.normalize', 'URL', 'new URL()', 'structuredClone',
]);
const SANITIZER_FUNCTIONS: Record<string, string> = {
  Number: 'number',
  parseInt: 'number',
  parseFloat: 'number',
  'Number.parseInt': 'number',
  'Number.parseFloat': 'number',
  Boolean: 'number',
  encodeURIComponent: 'uri-component',
  'path#basename': 'basename',
  'path.basename': 'basename',
};

const MODEL_CALL = /(^|[.#])(generateText|generateObject|streamText|streamObject)$|chat\.completions\.create$|(^|\.)messages\.create$|(^|\.)responses\.create$|(^|\.)generateContent(Stream)?$|(^|\.)completions\.create$/;

export class TaintTracker {
  private scope: Scope = { vars: new Map(), parent: null, fn: null };
  readonly imports: ImportMap;
  /** Set when the whole module is a Server Actions module ('use server' at the top). */
  readonly serverActionsModule: boolean;
  private readonly routeFile: boolean;

  constructor(imports: ImportMap, options: { serverActionsModule: boolean; routeFile: boolean }) {
    this.imports = imports;
    this.serverActionsModule = options.serverActionsModule;
    this.routeFile = options.routeFile;
  }

  get currentFunction(): FunctionNode | null {
    let s: Scope | null = this.scope;
    while (s && !s.fn) s = s.parent;
    return s?.fn ?? null;
  }

  enterFunction(fn: FunctionNode, parents: readonly Node[]): void {
    this.scope = { vars: new Map(), parent: this.scope, fn };
    const role = this.functionRole(fn, parents);
    if (!role) return;
    const line = lineOf(fn);
    fn.params.forEach((param, index) => {
      const names = bindingNames(param as Node);
      if (role === 'server-action') {
        for (const name of names) this.bind(name, { taint: { kind: 'request', source: 'Server Action argument', line, via: [] } });
      } else if (role === 'tool') {
        for (const name of names) this.bind(name, { taint: { kind: 'model', source: 'tool argument chosen by the model', line, via: [] } });
      } else if (role === 'trpc') {
        if (param.type === 'ObjectPattern') {
          for (const p of param.properties) {
            if (p.type === 'ObjectProperty' && keyName(p) === 'input') {
              for (const name of bindingNames(p.value as Node)) this.bind(name, { taint: { kind: 'request', source: 'tRPC input', line, via: [] } });
            }
          }
        }
      } else if (role === 'handler') {
        if (param.type === 'Identifier') {
          if (index === 0) this.bind(param.name, { taint: null, requestObject: true });
          else if (index === 1 && /^(ctx|context)$/.test(param.name)) this.bind(param.name, { taint: null, requestObject: true });
        } else if (param.type === 'ObjectPattern') {
          for (const p of param.properties) {
            if (p.type !== 'ObjectProperty') continue;
            const key = keyName(p);
            const names2 = bindingNames(p.value as Node);
            if (key === 'request' || key === 'url' || key === 'req') for (const n of names2) this.bind(n, { taint: null, requestObject: true });
            else if (key === 'params' || key === 'query' || key === 'searchParams' || key === 'body' || key === 'cookies' || key === 'headers') {
              for (const n of names2) this.bind(n, { taint: { kind: 'request', source: `request ${key}`, line, via: [] } });
            }
          }
        }
      }
    });
  }

  exitFunction(): void {
    if (this.scope.parent) this.scope = this.scope.parent;
  }

  private bind(name: string, binding: Binding): void {
    this.scope.vars.set(name, binding);
  }

  private lookup(name: string): Binding | undefined {
    let s: Scope | null = this.scope;
    while (s) {
      const b = s.vars.get(name);
      if (b) return b;
      s = s.parent;
    }
    return undefined;
  }

  /** Record a variable declaration so later uses see its taint. */
  declare(decl: VariableDeclarator): void {
    this.imports.recordRequire(decl);
    const init = decl.init ?? null;
    if (!init) return;
    const inner = unwrap(init);
    const isRequestObj = this.isRequestObject(inner);
    const isModelObj = this.isModelCall(inner) || (inner?.type === 'Identifier' && this.lookup(inner.name)?.modelObject === true);
    const taint = this.taintOf(init);
    if (decl.id.type === 'Identifier') {
      this.bind(decl.id.name, { taint: isModelObj ? taint ?? this.modelTaint(inner as Node) : taint, requestObject: isRequestObj, modelObject: isModelObj });
    } else {
      for (const name of bindingNames(decl.id)) {
        this.bind(name, { taint: taint ?? (isModelObj ? this.modelTaint(inner as Node) : null) });
      }
      // const { request, params } = event
      if (decl.id.type === 'ObjectPattern' && isRequestObj) {
        for (const p of decl.id.properties) {
          if (p.type === 'ObjectProperty' && (keyName(p) === 'request' || keyName(p) === 'url')) {
            for (const name of bindingNames(p.value as Node)) this.bind(name, { taint: null, requestObject: true });
          }
        }
      }
    }
  }

  assign(left: Node, right: Node): void {
    if (left.type === 'Identifier') {
      const existing = this.lookup(left.name);
      const taint = this.taintOf(right);
      if (existing) existing.taint = taint ?? existing.taint;
      else this.bind(left.name, { taint });
    }
  }

  private modelTaint(node: Node): Taint {
    return { kind: 'model', source: 'model output', line: lineOf(node), via: [] };
  }

  isModelCall(node: Node | null): boolean {
    const n = unwrap(node);
    if (!n || (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression')) return false;
    const callee = this.imports.canonical(n.callee) ?? '';
    return MODEL_CALL.test(callee);
  }

  isRequestObject(node: Node | null): boolean {
    const n = unwrap(node);
    if (!n) return false;
    if (n.type === 'Identifier') {
      const b = this.lookup(n.name);
      if (b) return b.requestObject === true;
      return n.name === 'req' || n.name === 'request';
    }
    const path = memberPath(n);
    if (!path) return false;
    if (/^(c|ctx|context)\.req$/.test(path) || /^(event|ctx|context)\.(request|url)$/.test(path) || /^Astro\.(request|url)$/.test(path)) return true;
    if (/\.request$/.test(path)) {
      const head = path.split('.')[0] as string;
      return this.lookup(head)?.requestObject === true;
    }
    return false;
  }

  taintOf(node: Node | null | undefined): Taint | null {
    return this.eval(node, 0);
  }

  private eval(node: Node | null | undefined, depth: number): Taint | null {
    if (!node || depth > 40) return null;
    switch (node.type) {
      case 'Identifier': {
        const b = this.lookup(node.name);
        return b?.taint ?? null;
      }
      case 'AwaitExpression':
      case 'TSAsExpression':
      case 'TSNonNullExpression':
      case 'TSSatisfiesExpression':
      case 'TSTypeAssertion':
      case 'ParenthesizedExpression':
      case 'TypeCastExpression':
      case 'SpreadElement':
        return this.eval(((node as { expression?: Node; argument?: Node }).expression ?? (node as { argument?: Node }).argument) as Node, depth + 1);
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return this.evalMember(node, depth);
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.evalCall(node, depth);
      case 'NewExpression': {
        const callee = memberPath(node.callee);
        if (callee === 'URL' || callee === 'Request' || callee === 'URLSearchParams') {
          for (const arg of node.arguments) {
            const t = this.eval(arg as Node, depth + 1);
            if (t) return t;
          }
        }
        return null;
      }
      case 'TemplateLiteral': {
        for (let i = 0; i < node.expressions.length; i++) {
          const t = this.eval(node.expressions[i] as Node, depth + 1);
          if (t) {
            const before = node.quasis.slice(0, i + 1).map((q) => q.value.cooked ?? q.value.raw).join('');
            return { ...t, pathOnly: /^[a-z][a-z0-9+.-]*:\/\/[^/${}]+\//i.test(before) };
          }
        }
        return null;
      }
      case 'BinaryExpression': {
        if (node.operator !== '+') return null;
        const left = this.eval(node.left as Node, depth + 1);
        if (left) return left;
        const right = this.eval(node.right, depth + 1);
        if (!right) return null;
        const prefix = stringValue(node.left as Node);
        return { ...right, pathOnly: prefix ? /^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i.test(prefix) : false };
      }
      case 'ConditionalExpression':
        return this.eval(node.consequent, depth + 1) ?? this.eval(node.alternate, depth + 1);
      case 'LogicalExpression':
        return this.eval(node.left, depth + 1) ?? this.eval(node.right, depth + 1);
      case 'ObjectExpression': {
        for (const p of node.properties) {
          const t = p.type === 'SpreadElement' ? this.eval(p.argument, depth + 1) : p.type === 'ObjectProperty' ? this.eval(p.value as Node, depth + 1) : null;
          if (t) return t;
        }
        return null;
      }
      case 'ArrayExpression': {
        for (const e of node.elements) {
          const t = e ? this.eval(e as Node, depth + 1) : null;
          if (t) return t;
        }
        return null;
      }
      case 'AssignmentExpression':
        return this.eval(node.right, depth + 1);
      case 'SequenceExpression':
        return this.eval(node.expressions[node.expressions.length - 1] as Node, depth + 1);
      default:
        return null;
    }
  }

  private evalMember(node: Node & { object: Node }, depth: number): Taint | null {
    const line = lineOf(node);
    const path = memberPath(node);
    if (path) {
      const source = globalSource(path);
      if (source) return { kind: 'request', source, line, via: [] };
    }
    const prop = propertyName(node);
    if (this.isRequestObject(node.object)) {
      if (prop && REQUEST_PROPS.has(prop)) return { kind: 'request', source: `request ${prop}`, line, via: [] };
      return null;
    }
    const objTaint = this.eval(node.object, depth + 1);
    if (objTaint) return objTaint;
    return null;
  }

  private evalCall(node: CallExpression | Node, depth: number): Taint | null {
    const call = node as CallExpression;
    const line = lineOf(node);
    const callee = call.callee as Node;
    const canonical = this.imports.canonical(callee) ?? '';

    // Model output
    if (MODEL_CALL.test(canonical)) return { kind: 'model', source: 'model output', line, via: [] };

    // Sanitizers end the flow for their category.
    const sanitizer = SANITIZER_FUNCTIONS[canonical] ?? SANITIZER_FUNCTIONS[canonical.replace(/^.*#/, '')];
    if (sanitizer) {
      const inner = this.eval(call.arguments[0] as Node, depth + 1);
      return inner ? { ...inner, via: [...inner.via, sanitizer] } : null;
    }
    if (/(^|[.#])(sanitize|escapeHtml|escape|encode|purify)$/i.test(canonical) || /^(DOMPurify|purify|sanitizeHtml|xss|he|validator)[.#]/.test(canonical) || canonical === 'sanitizeHtml' || canonical === 'xss') {
      const inner = this.eval(call.arguments[0] as Node, depth + 1);
      return inner ? { ...inner, via: [...inner.via, 'html-sanitizer'] } : null;
    }
    if (/(^|[.#])(safeParse|parse|parseAsync|safeParseAsync)$/.test(canonical) && callee.type !== 'Identifier' && !/^JSON\./.test(canonical)) {
      const inner = this.eval(call.arguments[call.arguments.length - 1] as Node, depth + 1);
      return inner ? { ...inner, via: [...inner.via, 'schema'] } : null;
    }

    // Request sources through calls: request.json(), c.req.query(), searchParams.get(), headers(), cookies()
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      const method = propertyName(callee);
      if (method && REQUEST_METHODS.has(method) && this.isRequestObject(callee.object)) {
        return { kind: 'request', source: `request ${method}()`, line, via: [] };
      }
      if (method === 'get' || method === 'getAll') {
        const objPath = memberPath(callee.object) ?? '';
        if (/(^|\.)(searchParams|query|formData|headers|cookies|params)$/.test(objPath) || /useSearchParams\(\)$/.test(objPath)) {
          const objTaint = this.eval(callee.object, depth + 1);
          if (objTaint || /(^|\.)searchParams$/.test(objPath) || /useSearchParams\(\)$/.test(objPath)) {
            return objTaint ?? { kind: 'request', source: 'query string', line, via: [] };
          }
        }
      }
      // fetch(...).then(r => r.text()) style and response bodies
      if (method && ['text', 'json'].includes(method)) {
        const obj = unwrap(callee.object);
        const objName = obj?.type === 'Identifier' ? obj.name : null;
        const b = objName ? this.lookup(objName) : undefined;
        if (b?.taint?.kind === 'external') return b.taint;
      }
      if (method && PASS_THROUGH_METHODS.has(method)) {
        const objTaint = this.eval(callee.object, depth + 1);
        if (objTaint) return objTaint;
      }
    }
    if (canonical === 'fetch' || /^(axios|got|ky)(\.(get|post))?$/.test(canonical) || canonical === 'undici#fetch') {
      return { kind: 'external', source: 'network response', line, via: [] };
    }
    if (/(^|#)(headers|cookies)$/.test(canonical) && (canonical.startsWith('next/headers#') || canonical === 'headers' || canonical === 'cookies')) {
      return canonical.startsWith('next/headers#') ? { kind: 'request', source: `request ${canonical.split('#')[1]}`, line, via: [] } : null;
    }
    if (/(^|#)use(SearchParams|Params)$/.test(canonical)) return { kind: 'request', source: 'URL parameters', line, via: [] };

    // Pass-through functions keep the taint of their arguments.
    const bare = canonical.replace(/^[^#]+#/, (m) => (m.startsWith('path#') ? m : ''));
    if (PASS_THROUGH_FUNCTIONS.has(canonical) || PASS_THROUGH_FUNCTIONS.has(bare)) {
      for (const arg of call.arguments) {
        const t = this.eval(arg as Node, depth + 1);
        if (t) return { ...t, via: [...t.via, canonical.toLowerCase()] };
      }
    }
    return null;
  }

  private functionRole(fn: FunctionNode, parents: readonly Node[]): 'handler' | 'server-action' | 'tool' | 'trpc' | null {
    const parent = parents[parents.length - 1];
    const grand = parents[parents.length - 2];
    const name = functionName(fn, parent);

    // Inline or module-level Server Actions.
    if (fn.body.type === 'BlockStatement' && fn.body.directives?.some((d) => d.value.value === 'use server')) return 'server-action';
    if (this.serverActionsModule && fn.async && isExported(fn, parents)) return 'server-action';

    // Route handlers: export async function POST(request) / export const GET = ...
    if (name && HTTP_METHODS.has(name) && isExported(fn, parents)) return 'handler';
    if (name && /^(loader|action|clientLoader|clientAction)$/.test(name) && isExported(fn, parents)) return 'handler';
    if (this.routeFile && name === 'handler' && isExported(fn, parents)) return 'handler';
    if (this.routeFile && isDefaultExport(fn, parents)) return 'handler';

    // SvelteKit actions: export const actions = { default: async ({ request }) => ... }
    if (parent?.type === 'ObjectProperty' && grand?.type === 'ObjectExpression') {
      const owner = parents[parents.length - 3];
      if (owner?.type === 'VariableDeclarator' && owner.id.type === 'Identifier' && owner.id.name === 'actions') return 'handler';
    }

    // Callbacks: app.get('/x', (req, res) => ...), router.post(...), tool({ execute }), server.tool(...)
    if (parent?.type === 'CallExpression' || parent?.type === 'OptionalCallExpression') {
      const callee = this.imports.canonical(parent.callee as Node) ?? '';
      if (/(^|\.)(get|post|put|patch|delete|all|use|options|head|route|on)$/.test(callee) && parent.arguments.some((a) => stringValue(a as Node)?.startsWith('/'))) return 'handler';
      if (/(^|\.)(mutation|query|subscription)$/.test(callee) && /(procedure|Procedure)/.test(callee)) return 'trpc';
      if (/(^|\.)(tool|registerTool)$/.test(callee) && /^(server|mcp|mcpServer)\./.test(callee)) return 'tool';
    }
    if (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod' || fn.type === 'ObjectMethod') {
      const key = fn.type === 'ObjectMethod' ? keyName(fn) : parent ? keyName(parent) : null;
      if (key === 'execute' || key === 'handler' || key === 'func') {
        const obj = fn.type === 'ObjectMethod' ? parent : grand;
        const call = fn.type === 'ObjectMethod' ? grand : parents[parents.length - 3];
        if (obj?.type === 'ObjectExpression' && (call?.type === 'CallExpression' || call?.type === 'NewExpression')) {
          const callee = this.imports.canonical((call as CallExpression | NewExpression).callee as Node) ?? '';
          if (/(^|[.#])(tool|dynamicTool|createTool|DynamicStructuredTool|DynamicTool|defineTool)$/.test(callee)) return key === 'handler' && !/tool/i.test(callee) ? null : 'tool';
        }
        if (key === 'execute' && obj?.type === 'ObjectExpression' && objectProp(obj, 'parameters' as never) !== null) return 'tool';
        if (key === 'execute' && obj?.type === 'ObjectExpression' && (objectProp(obj, 'inputSchema') !== null || objectProp(obj, 'description') !== null)) return 'tool';
      }
    }
    // Next.js Pages API and generic handlers named req/request.
    const first = fn.params[0];
    if (first?.type === 'Identifier' && /^(req|request)$/.test(first.name)) return 'handler';
    return null;
  }
}

function globalSource(path: string): string | null {
  if (/^(window\.)?location\.(search|hash|href)$|^document\.(location|URL|referrer|cookie)$/.test(path)) return 'browser URL';
  if (/^Astro\.(params|url\.searchParams)(\.|$)/.test(path)) return 'request parameters';
  if (/^router\.query(\.|$)/.test(path)) return 'URL query';
  if (/^event\.(body|queryStringParameters|pathParameters|headers)(\.|$)/.test(path)) return 'request event';
  return null;
}

function functionName(fn: FunctionNode, parent: Node | undefined): string | null {
  if ((fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') && fn.id) return fn.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((fn.type === 'ObjectMethod' || fn.type === 'ClassMethod') && fn.key.type === 'Identifier') return fn.key.name;
  return null;
}

function isExported(fn: FunctionNode, parents: readonly Node[]): boolean {
  const parent = parents[parents.length - 1];
  if (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration') return true;
  if (parent?.type === 'VariableDeclarator') {
    const decl = parents[parents.length - 2];
    return parents[parents.length - 3]?.type === 'ExportNamedDeclaration' && decl?.type === 'VariableDeclaration';
  }
  if (fn.type === 'FunctionDeclaration') return false;
  return false;
}

function isDefaultExport(fn: FunctionNode, parents: readonly Node[]): boolean {
  return parents[parents.length - 1]?.type === 'ExportDefaultDeclaration';
}

export function calleeOf(node: Node): Node | null {
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') return node.callee as Node;
  return null;
}

export function enclosingFunction(parents: readonly Node[]): FunctionNode | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (isFunctionNode(p)) return p as FunctionNode;
  }
  return null;
}

export type { Expression };
