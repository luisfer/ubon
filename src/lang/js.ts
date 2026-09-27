import type {
  CallExpression,
  Expression,
  File as BabelFile,
  Function as FunctionNode,
  Identifier,
  LVal,
  MemberExpression,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  OptionalCallExpression,
  OptionalMemberExpression,
  PatternLike,
  VariableDeclarator,
} from '@babel/types';
import { isFunctionNode, walk } from './walk.ts';

/**
 * JavaScript helpers shared by rules: member paths, literal values, import
 * aliases, schema shapes, and a small intra-function taint tracker.
 *
 * Taint is deliberately simple. Sources are request data, model output, tool
 * arguments chosen by a model, and network responses. Values flow through
 * local bindings, destructuring, templates, concatenation, iteration
 * callbacks, and a fixed list of pass-through functions. Unknown function
 * calls end the flow, which trades some missed findings for precision.
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
    case 'TSParameterProperty':
      return bindingNames(pattern.parameter);
    default:
      return [];
  }
}

export type CallLike = CallExpression | OptionalCallExpression;
export type MemberLike = MemberExpression | OptionalMemberExpression;

export function isCallNode(node: Node | null | undefined): node is CallLike {
  return !!node && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression');
}

export function isMemberNode(node: Node | null | undefined): node is MemberLike {
  return !!node && (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression');
}

/** Last name of a callee: `z.string` -> 'string', `tool` -> 'tool'. */
export function calleeName(callee: Node | null | undefined): string | null {
  const n = unwrap(callee);
  if (!n) return null;
  if (n.type === 'Identifier') return n.name;
  if (isMemberNode(n)) return propertyName(n);
  return null;
}

// ---------------------------------------------------------------------------
// Module-level constants

const TOP_CONSTS = new WeakMap<object, Map<string, Node>>();

/** Initializer of a module-level `const` (exported or not), or null. */
export function topLevelConst(program: BabelFile | null | undefined, name: string): Node | null {
  if (!program) return null;
  let map = TOP_CONSTS.get(program);
  if (!map) {
    map = new Map();
    for (const stmt of program.program.body) {
      const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
      if (decl?.type !== 'VariableDeclaration' || decl.kind !== 'const') continue;
      for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) map.set(d.id.name, d.init);
    }
    TOP_CONSTS.set(program, map);
  }
  return map.get(name) ?? null;
}

function resolveConst(program: BabelFile | null, node: Node | null | undefined, depth: number): Node | null {
  let n = unwrap(node);
  let hops = 0;
  while (n?.type === 'Identifier' && hops < 4 && depth < 8) {
    const init = topLevelConst(program, n.name);
    if (!init) return n;
    n = unwrap(init);
    hops++;
  }
  return n;
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
  /** The parsed program (for resolving module-level constants such as schemas). */
  readonly program: BabelFile;

  constructor(file: BabelFile) {
    this.program = file;
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
// Schemas (zod, valibot, yup, joi, typebox, JSON schema)

/**
 * safe: the field only admits numbers, booleans, dates, fixed values
 * (enum, literal), identifiers with a fixed format (uuid, cuid), a regex, or a
 * custom refinement. open: any string. unknown: Ubon cannot tell.
 */
export type SchemaFieldKind = 'safe' | 'open' | 'unknown';

export interface SchemaField {
  kind: SchemaFieldKind;
  /** For nested object fields: the nested schema, so deeper property reads can be classified. */
  schema?: Node;
}

const SAFE_SCHEMA_ROOTS = new Set([
  'enum', 'nativeEnum', 'literal', 'number', 'int', 'int32', 'int64', 'uint32', 'uint64', 'float32', 'float64', 'bigint', 'boolean', 'bool',
  'stringbool', 'date', 'nan', 'null', 'undefined', 'void', 'never', 'picklist', 'enum_', 'integer', 'safeInteger', 'uuid', 'uuidv4', 'uuidv6',
  'uuidv7', 'guid', 'cuid', 'cuid2', 'ulid', 'nanoid', 'xid', 'ksuid', 'ipv4', 'ipv6', 'cidrv4', 'cidrv6', 'mac', 'datetime', 'time', 'isoDate',
  'isoDateTime', 'isoTime', 'isoTimestamp', 'Number', 'Integer', 'Boolean', 'Literal', 'Enum', 'Null', 'Date', 'Uuid', 'KeyOf',
]);
const OPEN_SCHEMA_ROOTS = new Set(['string', 'String', 'any', 'unknown', 'custom', 'url', 'httpUrl', 'email', 'Any', 'Unknown', 'mixed', 'text']);
const OBJECT_SCHEMA_ROOTS = new Set(['object', 'strictObject', 'looseObject', 'Object', 'looseObject']);
const CONSTRAINING_METHODS = new Set([
  'uuid', 'cuid', 'cuid2', 'ulid', 'regex', 'datetime', 'date', 'time', 'ip', 'ipv4', 'ipv6', 'cidr', 'nanoid', 'refine', 'superRefine', 'check',
  'oneOf', 'matches', 'valid', 'pattern', 'guid', 'isoDate', 'isoDateTime', 'isoTime',
]);
const SHAPE_PRESERVING = /^(pick|omit|partial|required|strict|strip|passthrough|describe|optional|nullable|nullish|default|catch|readonly|brand|meta|openapi|deepPartial|catchall|superRefine|refine|check|noUnknown|unknown|label|prefault)$/;

function arrayElements(node: Node | null | undefined): Node[] {
  const n = unwrap(node);
  if (!n || n.type !== 'ArrayExpression') return [];
  return n.elements.filter((e): e is NonNullable<typeof e> => e !== null && e.type !== 'SpreadElement') as Node[];
}

function shapeOfObject(obj: ObjectExpression): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const p of obj.properties) if (p.type === 'ObjectProperty') {
    const k = keyName(p);
    if (k !== null) out.set(k, p.value as Node);
  }
  return out;
}

/** Field map of an object schema (z.object, a raw zod shape, a JSON schema), or null. */
export function schemaShape(program: BabelFile | null, node: Node | null | undefined, depth = 0): Map<string, Node> | null {
  if (depth > 8) return null;
  const n = resolveConst(program, node, depth);
  if (!n) return null;
  if (n.type === 'ObjectExpression') {
    const props = unwrap(objectProp(n, 'properties'));
    const type = stringValue(objectProp(n, 'type'));
    if (props?.type === 'ObjectExpression' && (type === 'object' || type === null)) return shapeOfObject(props);
    return shapeOfObject(n);
  }
  if (!isCallNode(n)) return null;
  const name = calleeName(n.callee);
  if (!name) return null;
  if (isMemberNode(n.callee) && isCallNode(unwrap(n.callee.object))) {
    const base = unwrap(n.callee.object) as Node;
    if (name === 'extend' || name === 'safeExtend' || name === 'merge' || name === 'and' || name === 'shape' || name === 'keys' || name === 'append') {
      const a = schemaShape(program, base, depth + 1);
      const b = schemaShape(program, n.arguments[0] as Node, depth + 1);
      if (!a && !b) return null;
      return new Map([...(a ?? []), ...(b ?? [])]);
    }
    if (SHAPE_PRESERVING.test(name)) return schemaShape(program, base, depth + 1);
    return null;
  }
  if (OBJECT_SCHEMA_ROOTS.has(name) || name === 'jsonSchema' || name === 'zodToJsonSchema' || name === 'toJSONSchema' || name === 'valibotSchema' || name === 'zodSchema') {
    return schemaShape(program, n.arguments[0] as Node, depth + 1);
  }
  return null;
}

function classifyJsonSchema(program: BabelFile | null, obj: ObjectExpression, depth: number): SchemaField {
  if (objectProp(obj, 'enum') || objectProp(obj, 'const')) return { kind: 'safe' };
  const typeNode = objectProp(obj, 'type');
  const single = stringValue(typeNode);
  const types = single !== null ? [single] : arrayElements(typeNode).map((e) => stringValue(e) ?? '');
  if (types.length > 0) {
    if (types.every((t) => t === 'number' || t === 'integer' || t === 'boolean' || t === 'null')) return { kind: 'safe' };
    if (types.includes('object')) return { kind: 'unknown', schema: obj };
    if (types.includes('array')) {
      const items = objectProp(obj, 'items');
      return items ? classifySchemaField(program, items, depth + 1) : { kind: 'open' };
    }
    if (types.includes('string')) {
      if (objectProp(obj, 'pattern')) return { kind: 'safe' };
      const format = stringValue(objectProp(obj, 'format'));
      if (format && /^(uuid|date|date-time|time|ipv4|ipv6|duration)$/.test(format)) return { kind: 'safe' };
      return { kind: 'open' };
    }
  }
  for (const key of ['anyOf', 'oneOf']) {
    const list = arrayElements(objectProp(obj, key));
    if (list.length > 0) return list.every((m) => classifySchemaField(program, m, depth + 1).kind === 'safe') ? { kind: 'safe' } : { kind: 'open' };
  }
  // A nested raw shape or an object schema without a type: keep looking deeper.
  return { kind: 'unknown', schema: obj };
}

/** Classify one field schema expression. */
export function classifySchemaField(program: BabelFile | null, node: Node | null | undefined, depth = 0): SchemaField {
  if (depth > 8) return { kind: 'unknown' };
  const n = resolveConst(program, node, depth);
  if (!n) return { kind: 'unknown' };
  if (n.type === 'ObjectExpression') return classifyJsonSchema(program, n, depth);
  if (!isCallNode(n)) return { kind: 'unknown' };
  const methods: Array<{ name: string; args: Node[] }> = [];
  let cur: Node = n;
  while (isCallNode(cur) && isMemberNode(cur.callee) && isCallNode(unwrap(cur.callee.object))) {
    methods.unshift({ name: propertyName(cur.callee) ?? '', args: cur.arguments as Node[] });
    cur = unwrap(cur.callee.object) as Node;
  }
  if (!isCallNode(cur)) return { kind: 'unknown' };
  const root = calleeName(cur.callee) ?? '';
  const args = cur.arguments as Node[];
  const sub = (x: Node | undefined) => classifySchemaField(program, x, depth + 1);
  let base: SchemaField;
  if (SAFE_SCHEMA_ROOTS.has(root)) base = { kind: 'safe' };
  else if (root === 'union' || root === 'discriminatedUnion' || root === 'variant' || root === 'Union' || root === 'xor') {
    const members = root === 'discriminatedUnion' || root === 'variant' ? arrayElements(args[1]) : arrayElements(args[0]);
    base = members.length > 0 && members.every((m) => sub(m).kind === 'safe') ? { kind: 'safe' } : { kind: 'open' };
  } else if (root === 'array' || root === 'set' || root === 'Array' || root === 'optional' || root === 'nullable' || root === 'nullish' || root === 'exactOptional' || root === 'undefinedable' || root === 'Optional' || root === 'readonly') {
    base = sub(args[0]);
  } else if (root === 'tuple' || root === 'Tuple') {
    const members = arrayElements(args[0]);
    base = members.length > 0 && members.every((m) => sub(m).kind === 'safe') ? { kind: 'safe' } : { kind: 'open' };
  } else if (root === 'pipe') {
    const first = sub(args[0]);
    const constrained = args.slice(1).some((a) => {
      const inner = unwrap(a);
      const nm = isCallNode(inner) ? calleeName(inner.callee) : null;
      return nm !== null && (CONSTRAINING_METHODS.has(nm) || SAFE_SCHEMA_ROOTS.has(nm) || nm === 'picklist');
    });
    base = first.kind === 'safe' || constrained ? { kind: 'safe' } : first;
  } else if (OBJECT_SCHEMA_ROOTS.has(root)) base = { kind: 'unknown', schema: n };
  else if (OPEN_SCHEMA_ROOTS.has(root)) base = { kind: 'open' };
  else base = { kind: 'unknown' };
  for (const m of methods) {
    if (CONSTRAINING_METHODS.has(m.name)) base = { kind: 'safe' };
    else if (m.name === 'or') {
      const other = sub(m.args[0]);
      base = base.kind === 'safe' && other.kind === 'safe' ? { kind: 'safe' } : base.kind === 'open' || other.kind === 'open' ? { kind: 'open' } : { kind: 'unknown' };
    } else if (m.name === 'pipe') {
      if (sub(m.args[0]).kind === 'safe') base = { kind: 'safe' };
    } else if (m.name === 'transform') {
      if (base.kind !== 'safe') base = { kind: 'unknown' };
    } else if (m.name === 'extend' || m.name === 'merge' || m.name === 'shape' || m.name === 'keys') {
      base = { kind: 'unknown', schema: n };
    }
  }
  return base;
}

/** Classify the field `key` of an object schema. */
export function schemaFieldOf(program: BabelFile | null, schema: Node | null | undefined, key: string): SchemaField {
  const shape = schemaShape(program, schema);
  if (!shape) return { kind: 'unknown' };
  const field = shape.get(key);
  if (!field) return { kind: 'unknown' };
  return classifySchemaField(program, field);
}

// ---------------------------------------------------------------------------
// Taint

/**
 * request: data an HTTP client controls (body, query, params, headers,
 * cookies, Server Action and tRPC arguments, the page URL in the browser).
 * model: output of a language model call. tool: arguments of a tool handler,
 * chosen by the model. external: bodies of network responses.
 */
export type TaintKind = 'request' | 'model' | 'tool' | 'external';

export interface Taint {
  kind: TaintKind;
  /** Where the value came from, as a phrase for messages: "the request body", "model output". */
  source: string;
  line: number;
  /** Functions the value passed through, lowercased (for sanitizer checks). */
  via: string[];
  /** For URLs built from parts: true when the tainted part comes after a fixed scheme and host. */
  pathOnly?: boolean;
  /**
   * Text before the tainted part when the value is built by a template or `+`.
   * Parts that are not string constants appear as U+0000. Absent or empty when
   * the tainted value starts the string.
   */
  prefix?: string;
  /** The value is (part of) the URL of the request being served, so its origin is the server's own. */
  ownUrl?: boolean;
  /** The value passed a schema validation (with 'schema' in `via`); property reads are classified by it. */
  schema?: Node;
  /** A schema that applies to one property of the value (generateObject's `object`). */
  schemaAt?: { key: string; schema: Node };
}

/** Placeholder in `Taint.prefix` for an untainted part whose text Ubon cannot read (a variable, a call). */
export const OPAQUE = '\u0000';
/** Placeholder in `Taint.prefix` for an untainted part that may be empty: an env read or a `?? ''` fallback. */
export const OPTIONAL = '\u0001';

/** True when a URL prefix fixes the scheme and host, so the tainted rest is a path, query, or fragment. */
export function hostFixed(prefix: string | undefined): boolean {
  if (!prefix) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#\\]+[/?#]/i.test(prefix)) return true;
  // A base URL from configuration or code, followed by a delimiter: `${API_URL}/users/${id}`.
  return /^[\u0000\u0001]/.test(prefix) && /[/?#]/.test(prefix.slice(1));
}

/** True when the tainted rest of a redirect target cannot change its origin (a fixed path or query prefix). */
export function redirectPrefixSafe(prefix: string | undefined): boolean {
  if (!prefix) return false;
  // Values that may be empty count as absent; other unknown values count as a non-empty segment.
  const text = prefix.split(OPTIONAL).join('').split(OPAQUE).join('x');
  // An absolute URL whose scheme and host come from code: `https://${HOST}/login?next=${x}`.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#\\]+[/?#]/i.test(text)) return true;
  if (/^\/[^/\\]/.test(text)) return true;
  if (/^[?#]/.test(text)) return true;
  return /^[\w.~-]+[/?#]/.test(text);
}

/** True when the tainted part directly follows a value Ubon cannot read, with no '/', '?', or '#' between them. */
export function joinedToUnknown(prefix: string | undefined): boolean {
  return !!prefix && /^[\u0000\u0001]+$/.test(prefix);
}

interface Binding {
  taints: Taint[];
  requestObject?: boolean;
  modelObject?: boolean;
  /** Per-property taints: tRPC options (`input`), chat hook results (`messages`), assigned properties. */
  members?: Map<string, Taint[]>;
  /** Properties not listed in `members` are clean. */
  membersOnly?: boolean;
  /** MCP CallTool request: `x.params.arguments` holds tool arguments. */
  toolRequest?: Taint;
}

interface Scope {
  vars: Map<string, Binding>;
  parent: Scope | null;
  fn: FunctionNode | null;
}

export type FunctionRole =
  | { type: 'server-action' }
  | { type: 'handler' }
  | { type: 'tool'; schema: Node | null; definition: Node | null }
  | { type: 'mcp-request' }
  | { type: 'trpc'; schema: Node | null };

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL']);

const REQUEST_PROPS = new Map<string, string>([
  ['body', 'the request body'],
  ['rawBody', 'the request body'],
  ['query', 'the query string'],
  ['searchParams', 'the query string'],
  ['params', 'route parameters'],
  ['headers', 'request headers'],
  ['cookies', 'cookies'],
  ['signedCookies', 'cookies'],
  ['files', 'an uploaded file'],
  ['file', 'an uploaded file'],
  ['formData', 'form data'],
  ['url', 'the request URL'],
  ['nextUrl', 'the request URL'],
  ['originalUrl', 'the request URL'],
  ['path', 'the request URL'],
  ['hostname', 'the Host header'],
]);
const OWN_URL_PROPS = new Set(['url', 'nextUrl', 'originalUrl', 'path', 'hostname']);
/** Parts of a URL that the client chooses even when the URL is the request's own. */
const QUERY_PARTS = new Set(['searchParams', 'search', 'hash', 'query']);
const HOST_HEADER = /^(host|x-forwarded-host|x-forwarded-proto|origin)$/i;

const REQUEST_METHODS = new Map<string, string>([
  ['json', 'the request body'],
  ['text', 'the request body'],
  ['arrayBuffer', 'the request body'],
  ['blob', 'the request body'],
  ['bytes', 'the request body'],
  ['parseBody', 'the request body'],
  ['formData', 'form data'],
  ['query', 'the query string'],
  ['queries', 'the query string'],
  ['param', 'route parameters'],
  ['header', 'request headers'],
  ['valid', 'validated request data'],
]);

const PASS_THROUGH_METHODS = new Set([
  'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'toString', 'slice', 'substring', 'substr',
  'split', 'join', 'replace', 'replaceAll', 'concat', 'at', 'get', 'getAll', 'padStart', 'padEnd', 'normalize', 'valueOf', 'filter', 'find', 'findLast',
  'flat', 'entries', 'values', 'keys', 'reverse', 'toReversed', 'sort', 'toSorted', 'match', 'matchAll', 'repeat', 'toJSON', 'trimLeft', 'trimRight',
  'then',
]);
/** Methods whose string arguments become part of the result. */
const ARGUMENT_METHODS = new Set(['concat', 'replace', 'replaceAll', 'padStart', 'padEnd', 'join']);
const BODY_READERS = new Set(['json', 'text', 'arrayBuffer', 'blob', 'bytes', 'formData']);
const ELEMENT_CALLBACKS = new Set(['map', 'forEach', 'filter', 'find', 'findLast', 'findIndex', 'some', 'every', 'flatMap', 'then', 'sort', 'toSorted']);

const PASS_THROUGH_FUNCTIONS = new Set([
  'String', 'decodeURIComponent', 'decodeURI', 'encodeURI', 'unescape', 'atob', 'JSON.parse', 'Object.fromEntries', 'Object.assign', 'Object.values',
  'Object.keys', 'Object.entries', 'Array.from', 'Array.of', 'Buffer.from', 'path#join', 'path#resolve', 'path#normalize', 'path#relative',
  'path#dirname', 'path#extname', 'path.join', 'path.resolve', 'path.normalize', 'path.relative', 'path.dirname', 'path.extname', 'URL', 'new URL()',
  'structuredClone', 'url#parse', 'url#format', 'qs#parse', 'querystring#parse', 'cookie#parse', 'util#format', 'fs#realpath', 'fs#realpathSync',
  'posix.join', 'posix.resolve', 'posix.normalize',
]);

const NUMERIC_FUNCTIONS = new Set([
  'Number', 'parseInt', 'parseFloat', 'Number.parseInt', 'Number.parseFloat', 'Boolean', 'BigInt', 'Math.floor', 'Math.ceil', 'Math.round',
  'Math.trunc', 'Math.abs', 'Math.min', 'Math.max', 'Math.sign',
]);

const MODEL_FUNCTIONS =
  /(^|[.#])(generateText|generateObject|streamText|streamObject)$|(^|\.)chat\.completions\.(create|parse|stream)$|(^|\.)responses\.(create|parse|stream)$|(^|\.)completions\.create$|(^|\.)(generateContent|generateContentStream)$/;
const MODEL_HOOK = /^(ai|ai\/react|ai\/svelte|ai\/vue|ai\/solid|@ai-sdk\/(react|svelte|vue|solid|angular))#(experimental_)?use(Chat|Completion|Object|Assistant)$/;
const MODEL_HOOK_KEYS = new Set(['messages', 'completion', 'object', 'data', 'experimental_output']);

const H3_SOURCES = new Map<string, { phrase: string; validated?: boolean; ownUrl?: boolean }>([
  ['readBody', { phrase: 'the request body' }],
  ['readRawBody', { phrase: 'the request body' }],
  ['readValidatedBody', { phrase: 'the request body', validated: true }],
  ['readFormData', { phrase: 'form data' }],
  ['readMultipartFormData', { phrase: 'form data' }],
  ['getQuery', { phrase: 'the query string' }],
  ['getValidatedQuery', { phrase: 'the query string', validated: true }],
  ['getRouterParam', { phrase: 'route parameters' }],
  ['getRouterParams', { phrase: 'route parameters' }],
  ['getValidatedRouterParams', { phrase: 'route parameters', validated: true }],
  ['getHeader', { phrase: 'request headers' }],
  ['getRequestHeader', { phrase: 'request headers' }],
  ['getHeaders', { phrase: 'request headers' }],
  ['getRequestHeaders', { phrase: 'request headers' }],
  ['getCookie', { phrase: 'cookies' }],
  ['parseCookies', { phrase: 'cookies' }],
  ['getRequestURL', { phrase: 'the request URL', ownUrl: true }],
]);

const NEST_SOURCES = new Map<string, string>([
  ['Body', 'the request body'],
  ['Query', 'the query string'],
  ['Param', 'route parameters'],
  ['Headers', 'request headers'],
  ['UploadedFile', 'an uploaded file'],
  ['UploadedFiles', 'an uploaded file'],
  ['Cookies', 'cookies'],
]);

function withVia(t: Taint, label: string): Taint {
  return t.via.includes(label) ? t : { ...t, via: [...t.via, label] };
}

function dropSchema(t: Taint): Taint {
  const { schema: _schema, ...rest } = t;
  return rest;
}

function syntheticMember(object: Node, key: string): MemberExpression {
  const property: Identifier = { type: 'Identifier', name: key };
  return {
    type: 'MemberExpression',
    object: object as Expression,
    property,
    computed: false,
    optional: false,
    loc: object.loc,
    start: object.start,
    end: object.end,
  };
}

function dedupe(taints: Taint[]): Taint[] {
  if (taints.length < 2) return taints;
  const seen = new Set<string>();
  const out: Taint[] = [];
  for (const t of taints) {
    const k = `${t.kind}\0${t.source}\0${t.line}\0${t.via.join(',')}\0${t.prefix ?? ''}\0${t.ownUrl ? 1 : 0}\0${t.schema ? t.schema.start : ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

type Part = { text: string } | { node: Node };

function concatParts(node: Node, out: Part[]): void {
  const n = unwrap(node) ?? node;
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    concatParts(n.left as Node, out);
    concatParts(n.right, out);
    return;
  }
  if (n.type === 'TemplateLiteral') {
    n.quasis.forEach((q, i) => {
      out.push({ text: q.value.cooked ?? q.value.raw });
      const e = n.expressions[i];
      if (e) concatParts(e as Node, out);
    });
    return;
  }
  if (n.type === 'StringLiteral') out.push({ text: n.value });
  else if (n.type === 'NumericLiteral') out.push({ text: String(n.value) });
  else out.push({ node: n });
}

/** 'drop' when a map callback ignores the element (placeholders), 'number' when it casts it. */
function callbackEffect(arg: Node | undefined): 'drop' | 'number' | 'keep' {
  const fn = unwrap(arg);
  if (!fn) return 'keep';
  if (fn.type === 'Identifier' && /^(Number|parseInt|parseFloat|Boolean|BigInt)$/.test(fn.name)) return 'number';
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return 'keep';
  const first = fn.params[0];
  const names = first ? bindingNames(first as Node) : [];
  if (names.length === 0) return 'drop';
  let referenced = false;
  walk(fn.body as Node, {
    enter(node) {
      if (node.type === 'Identifier' && names.includes(node.name)) referenced = true;
      return undefined;
    },
  });
  if (!referenced) return 'drop';
  const body = fn.body.type === 'BlockStatement' ? null : unwrap(fn.body as Node);
  if (body && isCallNode(body) && /^(Number|parseInt|parseFloat|Boolean|BigInt|Math\.\w+)$/.test(memberPath(body.callee) ?? '')) return 'number';
  if (body?.type === 'UnaryExpression' && (body.operator === '+' || body.operator === '-')) return 'number';
  return 'keep';
}

function isRegexLike(node: Node): boolean {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'RegExpLiteral') return true;
  if (n.type === 'NewExpression' && memberPath(n.callee) === 'RegExp') return true;
  if (n.type === 'Identifier') return /(re|regex|regexp|pattern|matcher|RE|REGEX|Regex|Pattern)$/i.test(n.name);
  return false;
}

/** An env read or a value with an empty-string fallback: it may add nothing to a URL. */
function maybeEmpty(node: Node | null): boolean {
  const n = unwrap(node);
  if (!n) return false;
  if (/^(process\.env|import\.meta\.env)\./.test(memberPath(n) ?? '')) return true;
  if (n.type === 'LogicalExpression') return maybeEmpty(n.left) || stringValue(n.right) === '' || maybeEmpty(n.right);
  if (n.type === 'ConditionalExpression') return stringValue(n.consequent) === '' || stringValue(n.alternate) === '' || maybeEmpty(n.consequent) || maybeEmpty(n.alternate);
  return false;
}

/** Label for known sanitizers and escapers; null when the callee is not one. */
function sanitizerLabel(canonical: string, imports: ImportMap): string | null {
  if (NUMERIC_FUNCTIONS.has(canonical)) return 'number';
  if (canonical === 'encodeURIComponent' || canonical === 'querystring#escape') return 'uri-component';
  if (canonical === 'path#basename' || canonical === 'path.basename' || canonical === 'posix.basename') return 'basename';
  if (
    /^(dompurify|isomorphic-dompurify|xss|sanitize-html|escape-html|html-escaper|escape-goat)#/.test(canonical) ||
    /^(he|entities|html-entities|validator|lodash|lodash-es|underscore)#(escape|encode|encodeHTML|escapeHTML|escapeUTF8|default\.escape)$/.test(canonical) ||
    /^lodash\.escape#default$/.test(canonical) ||
    /(^|\.)(DOMPurify|purify|domPurify|dompurify)\.sanitize$/.test(canonical) ||
    /^(sanitizeHtml|escapeHtml|escapeHTML|htmlEscape|filterXSS|xss|encodeHTML)$/.test(canonical) ||
    /(^|[.#])(escapeHtml|escapeHTML|htmlEscape|sanitizeHtml|sanitizeHTML)$/.test(canonical)
  ) {
    return 'html-sanitizer';
  }
  if (
    /^(mysql|mysql2|sqlstring|mysql2\/promise)#(escape|escapeId|format)$/.test(canonical) ||
    /^pg-format#/.test(canonical) ||
    /(^|\.)(escapeLiteral|escapeIdentifier)$/.test(canonical) ||
    (/(^|\.)(connection|conn|pool|db|mysql|client|SqlString|sqlstring)\.(escape|escapeId)$/.test(canonical) && imports.importsModule(/^(mysql|mysql2|sqlstring)/))
  ) {
    return 'sql-escape';
  }
  if (/^shell-quote#quote$|^shell-escape#|^shellwords#escape$|(^|[.#])(shellEscape|escapeShellArg|shellQuote|quoteShellArg)$/.test(canonical)) return 'shell-escape';
  return null;
}

/** Functions whose name says they sanitize or escape: the flow ends, as for any unknown function. */
const GENERIC_SANITIZER = /(^|[.#])(sanitize\w*|escape\w*|encode\w*|purify|clean(Html|HTML|Url|Path|Input)?)$/i;

function globalSource(path: string): string | null {
  if (/^(window\.|globalThis\.|self\.)?location\.(search|hash|href)$|^(window\.)?document\.(location|URL|documentURI|baseURI)$/.test(path)) return 'the page URL';
  if (/^(window\.)?document\.referrer$/.test(path)) return 'the referrer';
  if (/^(window\.)?document\.cookie$/.test(path)) return 'cookies';
  if (/^window\.name$/.test(path)) return 'the window name';
  if (/^Astro\.params(\.|$)/.test(path)) return 'route parameters';
  if (/^Astro\.url\.searchParams(\.|$)/.test(path)) return 'the query string';
  if (/^router\.query(\.|$)/.test(path)) return 'the query string';
  if (/^event\.(body)(\.|$)/.test(path)) return 'the request body';
  if (/^event\.(queryStringParameters|multiValueQueryStringParameters)(\.|$)/.test(path)) return 'the query string';
  if (/^event\.pathParameters(\.|$)/.test(path)) return 'route parameters';
  if (/^event\.headers(\.|$)/.test(path)) return 'request headers';
  // Angular: this.route.snapshot.queryParams, this.activatedRoute.snapshot.params
  const angular = /^this\.(route|activatedRoute|activeRoute)\.snapshot\.(queryParams|queryParamMap|params|paramMap|fragment|url)(\.|$)/.exec(path);
  if (angular) return /^query/.test(angular[2] as string) ? 'the query string' : /^param/.test(angular[2] as string) ? 'route parameters' : 'the page URL';
  return null;
}

export class TaintTracker {
  private scope: Scope = { vars: new Map(), parent: null, fn: null };
  readonly imports: ImportMap;
  /** Set when the whole module is a Server Actions module ('use server' at the top). */
  readonly serverActionsModule: boolean;
  private readonly routeFile: boolean;
  private readonly program: BabelFile | null;
  private readonly roles = new WeakMap<object, FunctionRole | null>();
  private anthropicCache: boolean | null = null;
  private langchainCache: boolean | null = null;

  constructor(imports: ImportMap, options: { serverActionsModule: boolean; routeFile: boolean }) {
    this.imports = imports;
    this.serverActionsModule = options.serverActionsModule;
    this.routeFile = options.routeFile;
    this.program = imports.program ?? null;
  }

  get currentFunction(): FunctionNode | null {
    let s: Scope | null = this.scope;
    while (s && !s.fn) s = s.parent;
    return s?.fn ?? null;
  }

  /** The role a function was given when it was entered (route handler, tool handler, ...), or null. */
  roleOf(fn: Node | null | undefined): FunctionRole | null {
    return fn ? (this.roles.get(fn) ?? null) : null;
  }

  enterFunction(fn: FunctionNode, parents: readonly Node[]): void {
    this.scope = { vars: new Map(), parent: this.scope, fn };
    const role = this.functionRole(fn, parents);
    this.roles.set(fn, role);
    const line = lineOf(fn);
    if (role) this.bindParams(fn, role, line);
    else {
      for (const param of fn.params) for (const name of bindingNames(param as Node)) this.bind(name, { taints: [] });
      this.bindCallbackParams(fn, parents);
    }
    this.bindDecoratedParams(fn, line);
  }

  exitFunction(): void {
    if (this.scope.parent) this.scope = this.scope.parent;
  }

  /** Bind the variable of a for-of or for-in loop (called when the loop is entered). */
  enterLoop(node: Node): void {
    if (node.type !== 'ForOfStatement' && node.type !== 'ForInStatement') return;
    const taints = this.ev(node.right, 0);
    const left = node.left;
    // A declared loop variable always shadows outer names; an existing variable is only updated with taint.
    if (left.type !== 'VariableDeclaration' && taints.length === 0) return;
    const pattern = left.type === 'VariableDeclaration' ? left.declarations[0]?.id : left;
    for (const name of bindingNames(pattern as Node)) this.bind(name, { taints });
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
    this.bindPattern(decl.id as Node, init, 0);
  }

  private bindPattern(pattern: Node, value: Node, depth: number): void {
    const inner = unwrap(value);
    if (pattern.type === 'Identifier') {
      const binding: Binding = { taints: this.ev(value, 0) };
      if (this.isRequestObject(inner)) binding.requestObject = true;
      if (inner && isCallNode(inner) && this.isModelHookCall(inner)) {
        binding.taints = [];
        binding.members = new Map([...MODEL_HOOK_KEYS].map((k) => [k, [this.modelTaint(lineOf(inner))]]));
        binding.membersOnly = true;
      } else if (this.isModelCall(inner)) {
        binding.modelObject = true;
      } else if (inner?.type === 'Identifier') {
        const src = this.lookup(inner.name);
        if (src) {
          if (src.members) binding.members = new Map(src.members);
          if (src.membersOnly) binding.membersOnly = true;
          if (src.toolRequest) binding.toolRequest = src.toolRequest;
          if (src.modelObject) binding.modelObject = true;
        }
      }
      this.bind(pattern.name, binding);
      return;
    }
    if (pattern.type === 'AssignmentPattern') {
      this.bindPattern(pattern.left as Node, value, depth + 1);
      return;
    }
    if (pattern.type === 'ObjectPattern' && depth < 6) {
      const requestObject = this.isRequestObject(inner);
      for (const p of pattern.properties) {
        if (p.type === 'RestElement') {
          const taints = this.ev(value, 0);
          for (const name of bindingNames(p.argument as Node)) this.bind(name, { taints });
          continue;
        }
        const key = keyName(p);
        const target = p.value as Node;
        if (key === null) {
          const taints = this.ev(value, 0);
          for (const name of bindingNames(target)) this.bind(name, { taints });
          continue;
        }
        const member = syntheticMember(value, key);
        if (requestObject && /^(request|url|req|event)$/.test(key)) {
          const taints = this.ev(member, 0);
          for (const name of bindingNames(target)) this.bind(name, { taints, requestObject: true });
          continue;
        }
        this.bindPattern(target, member, depth + 1);
      }
      return;
    }
    const taints = this.ev(value, 0);
    for (const name of bindingNames(pattern)) this.bind(name, { taints });
  }

  assign(left: Node, right: Node): void {
    if (left.type === 'Identifier') {
      const taints = this.ev(right, 0);
      const existing = this.lookup(left.name);
      if (existing) {
        if (taints.length > 0) existing.taints = taints;
        if (this.isRequestObject(unwrap(right))) existing.requestObject = true;
      } else this.bind(left.name, { taints });
      return;
    }
    if (isMemberNode(left)) {
      const root = unwrap(left.object as Node);
      const prop = propertyName(left);
      if (root?.type === 'Identifier' && prop) {
        const b = this.lookup(root.name);
        if (b) {
          const taints = this.ev(right, 0);
          if (taints.length > 0) {
            b.members ??= new Map();
            b.members.set(prop, taints);
          }
        }
      }
    }
  }

  private modelTaint(line: number): Taint {
    return { kind: 'model', source: 'model output', line, via: [] };
  }

  isModelCall(node: Node | null): boolean {
    const n = unwrap(node);
    if (!n || !isCallNode(n)) return false;
    const callee = this.imports.canonical(n.callee as Node) ?? '';
    return this.isModelCallee(callee);
  }

  private isModelCallee(canonical: string): boolean {
    if (!canonical) return false;
    if (MODEL_FUNCTIONS.test(canonical)) return true;
    if (/(^|\.)messages\.(create|stream)$/.test(canonical)) {
      this.anthropicCache ??= this.imports.importsModule(/^@anthropic-ai\//);
      return this.anthropicCache || /anthropic|claude/i.test(canonical);
    }
    if (/(^|\.)(llm|model|chat|chain|agent|chatModel|structuredLlm|structuredModel|runnable)\.(invoke|stream|batch)$/i.test(canonical)) {
      this.langchainCache ??= this.imports.importsModule(/^(@langchain\/|langchain)/);
      return this.langchainCache;
    }
    if (/^ollama#(chat|generate|default\.chat|default\.generate)$/.test(canonical)) return true;
    if (canonical === '@openai/agents#run') return true;
    if (/(^|\.)agent\.(generate|stream)$/i.test(canonical)) return this.imports.importsModule(/^(ai|@ai-sdk\/|@mastra\/)/);
    return false;
  }

  isModelHookCall(node: Node | null): boolean {
    const n = unwrap(node);
    if (!n || !isCallNode(n)) return false;
    return MODEL_HOOK.test(this.imports.canonical(n.callee as Node) ?? '');
  }

  isRequestObject(node: Node | null): boolean {
    const n = unwrap(node);
    if (!n) return false;
    if (n.type === 'Identifier') {
      const b = this.lookup(n.name);
      if (b) return b.requestObject === true;
      return (n.name === 'req' || n.name === 'request') && !this.imports.bindings.has(n.name);
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

  /** The first taint of a value, or null. */
  taintOf(node: Node | null | undefined): Taint | null {
    return this.ev(node, 0)[0] ?? null;
  }

  /** Every taint that reaches a value (a value can mix request data, model output, and constants). */
  taintsOf(node: Node | null | undefined): Taint[] {
    return dedupe(this.ev(node, 0));
  }

  private ev(node: Node | null | undefined, depth: number): Taint[] {
    if (!node || depth > 40) return [];
    switch (node.type) {
      case 'Identifier': {
        const b = this.lookup(node.name);
        if (!b) return [];
        if (b.membersOnly && b.members) return [...b.members.values()].flat();
        return b.taints;
      }
      case 'AwaitExpression':
      case 'TSAsExpression':
      case 'TSNonNullExpression':
      case 'TSSatisfiesExpression':
      case 'TSTypeAssertion':
      case 'ParenthesizedExpression':
      case 'TypeCastExpression':
      case 'SpreadElement':
        return this.ev(((node as { expression?: Node; argument?: Node }).expression ?? (node as { argument?: Node }).argument) as Node, depth + 1);
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return this.evMember(node, depth);
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.evCall(node, depth);
      case 'NewExpression':
        return this.evNew(node, depth);
      case 'TemplateLiteral': {
        const parts: Part[] = [];
        concatParts(node, parts);
        return this.evParts(parts, depth);
      }
      case 'BinaryExpression': {
        if (node.operator !== '+') return [];
        const parts: Part[] = [];
        concatParts(node, parts);
        return this.evParts(parts, depth);
      }
      case 'TaggedTemplateExpression': {
        if (memberPath(node.tag) !== 'String.raw') return [];
        const parts: Part[] = [];
        concatParts(node.quasi, parts);
        return this.evParts(parts, depth);
      }
      case 'ConditionalExpression':
        return [...this.ev(node.consequent, depth + 1), ...this.ev(node.alternate, depth + 1)];
      case 'LogicalExpression':
        return [...this.ev(node.left, depth + 1), ...this.ev(node.right, depth + 1)];
      case 'ObjectExpression': {
        const out: Taint[] = [];
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') out.push(...this.ev(p.argument, depth + 1));
          else if (p.type === 'ObjectProperty') out.push(...this.ev(p.value as Node, depth + 1));
        }
        return out;
      }
      case 'ArrayExpression': {
        const out: Taint[] = [];
        for (const e of node.elements) if (e) out.push(...this.ev(e as Node, depth + 1));
        return out;
      }
      case 'AssignmentExpression':
        return this.ev(node.right, depth + 1);
      case 'SequenceExpression':
        return this.ev(node.expressions[node.expressions.length - 1] as Node, depth + 1);
      default:
        return [];
    }
  }

  private evParts(parts: Part[], depth: number): Taint[] {
    const out: Taint[] = [];
    let prefix = '';
    for (const part of parts) {
      if ('text' in part) {
        prefix += part.text;
        continue;
      }
      const taints = this.ev(part.node, depth + 1);
      for (const t of taints) {
        const full = prefix + (t.prefix ?? '');
        out.push({ ...t, prefix: full, pathOnly: hostFixed(full) });
      }
      // After a tainted part that starts with a fixed path segment (url.pathname), later parts follow a path.
      const pathLike = taints.length > 0 && taints.every((t) => /^\/[^/\\]/.test((t.prefix ?? '').split(OPTIONAL).join('').split(OPAQUE).join('x')));
      prefix += taints.length > 0 ? (pathLike ? `/${OPAQUE}` : OPAQUE) : this.partText(part.node);
    }
    return out;
  }

  /** Text of an untainted part of a string: a module constant's value, or a placeholder. */
  private partText(node: Node): string {
    const n = unwrap(node);
    if (n?.type === 'Identifier') {
      const text = stringValue(topLevelConst(this.program, n.name));
      if (text !== null) return text;
    }
    return maybeEmpty(n) ? OPTIONAL : OPAQUE;
  }

  private evNew(node: NewExpression, depth: number): Taint[] {
    const canonical = this.imports.canonical(node.callee as Node) ?? '';
    const name = canonical.replace(/^[^#]*#/, '');
    const args = node.arguments as Node[];
    if (name === 'URL' && (canonical === 'URL' || canonical === 'url#URL' || canonical === 'globalThis.URL')) {
      const [a, b] = args;
      const ta = this.ev(a, depth + 1);
      if (!b) return ta;
      const tb = this.ev(b, depth + 1).filter((t) => !t.ownUrl);
      if (ta.length === 0) {
        const av = stringValue(a);
        if (av !== null && /^[a-z][a-z0-9+.-]*:/i.test(av)) return [];
        return tb;
      }
      const baseControlled = tb.length > 0;
      const out = ta.map((t) => {
        const p = t.prefix ?? '';
        if (!baseControlled && !hostFixed(p) && redirectPrefixSafe(p)) {
          const prefix = OPAQUE + p;
          return { ...t, prefix, pathOnly: true };
        }
        return t;
      });
      return [...out, ...tb];
    }
    if (name === 'Request' || name === 'URLSearchParams' || name === 'String') return this.ev(args[0], depth + 1);
    return [];
  }

  private evMember(node: Node, depth: number): Taint[] {
    const member = node as MemberLike;
    const line = lineOf(node);
    const prop = propertyName(member);
    if (prop === 'length' || prop === 'size' || prop === 'byteLength') return [];
    const path = memberPath(member);
    if (path) {
      const source = globalSource(path);
      if (source) return [{ kind: 'request', source, line, via: [] }];
    }
    const object = member.object as Node;
    const obj = unwrap(object);
    if (this.isRequestObject(obj)) {
      const phrase = prop ? REQUEST_PROPS.get(prop) : undefined;
      if (!phrase) return [];
      const t: Taint = { kind: 'request', source: phrase, line, via: [] };
      if (prop && OWN_URL_PROPS.has(prop)) t.ownUrl = true;
      return [t];
    }
    if (obj?.type === 'Identifier') {
      const b = this.lookup(obj.name);
      if (b) {
        const own = prop !== null ? b.members?.get(prop) : undefined;
        if (own) return own;
        if (b.membersOnly) return [];
      }
    }
    // MCP CallTool handlers: request.params.arguments
    if (prop === 'arguments' && obj && isMemberNode(obj) && propertyName(obj) === 'params') {
      const root = unwrap(obj.object as Node);
      if (root?.type === 'Identifier') {
        const b = this.lookup(root.name);
        if (b?.toolRequest) return [b.toolRequest];
      }
    }
    if (obj && isCallNode(obj)) {
      if (this.isModelHookCall(obj)) return prop && MODEL_HOOK_KEYS.has(prop) ? [this.modelTaint(line)] : [];
      const canonical = this.imports.canonical(obj.callee as Node) ?? '';
      if (/^next\/router#useRouter$/.test(canonical) && prop === 'query') return [{ kind: 'request', source: 'the query string', line, via: [] }];
    }
    const base = this.ev(object, depth + 1);
    return base.length > 0 ? this.memberOf(base, prop, line) : [];
  }

  private memberOf(base: Taint[], prop: string | null, line?: number): Taint[] {
    const out: Taint[] = [];
    for (const t of base) {
      if (prop !== null && t.ownUrl && QUERY_PARTS.has(prop)) {
        out.push({ kind: t.kind, source: 'the query string', line: line ?? t.line, via: t.via });
        continue;
      }
      if (prop === 'pathname') {
        out.push({ ...t, prefix: `/${OPAQUE}`, pathOnly: false });
        continue;
      }
      if (prop !== null && t.source === 'request headers' && HOST_HEADER.test(prop)) {
        out.push({ ...t, source: 'the Host header', ownUrl: true });
        continue;
      }
      if (prop !== null && t.schemaAt && prop === t.schemaAt.key) {
        const { schemaAt, ...rest } = t;
        out.push({ ...withVia(rest, 'schema'), schema: schemaAt.schema });
        continue;
      }
      if (prop !== null && t.schema && !/^\d+$/.test(prop)) {
        const field = schemaFieldOf(this.program, t.schema, prop);
        if (field.kind === 'safe') continue;
        if (field.kind === 'open') {
          const rest = dropSchema(t);
          out.push({ ...rest, via: rest.via.filter((v) => v !== 'schema') });
          continue;
        }
        const rest = withVia(dropSchema(t), 'schema');
        out.push(field.schema ? { ...rest, schema: field.schema } : rest);
        continue;
      }
      out.push(t);
    }
    return out;
  }

  private evCall(node: Node, depth: number): Taint[] {
    const call = node as CallLike;
    const line = lineOf(node);
    const callee = call.callee as Node;
    const args = call.arguments as Node[];
    const canonical = this.imports.canonical(callee) ?? '';
    const method = isMemberNode(callee) ? propertyName(callee) : null;

    // Model output
    if (this.isModelCallee(canonical)) return [this.modelTaintFor(call, canonical, line)];
    if (this.isModelHookCall(call)) return [];

    // Sanitizers keep the taint with a label, so each rule decides whether it neutralizes its sink.
    const label = sanitizerLabel(canonical, this.imports);
    if (label) return this.ev(args[0], depth + 1).map((t) => withVia(t, label));
    if (GENERIC_SANITIZER.test(canonical) && canonical !== 'encodeURI') return [];

    // Schema validation
    const parsed = this.schemaParse(call, canonical);
    if (parsed) {
      return this.ev(parsed.value, depth + 1).map((t) => {
        const labelled = withVia(t, 'schema');
        return parsed.schema ? { ...labelled, schema: parsed.schema } : labelled;
      });
    }

    if (method && isMemberNode(callee)) {
      const object = callee.object as Node;
      // Request data read through calls: request.json(), c.req.query(), req.get('host')
      const phrase = REQUEST_METHODS.get(method);
      if (phrase && this.isRequestObject(object)) {
        return [{ kind: 'request', source: phrase, line, via: method === 'valid' ? ['schema'] : [] }];
      }
      if (method === 'get' && this.isRequestObject(object) && /^(req|request)$/.test(memberPath(object) ?? '')) {
        const key = stringValue(args[0]);
        return [key && HOST_HEADER.test(key) ? { kind: 'request', source: 'the Host header', line, via: [], ownUrl: true } : { kind: 'request', source: 'request headers', line, via: [] }];
      }
      if (method === 'get' || method === 'getAll') {
        const objPath = memberPath(object) ?? '';
        const objTaints = this.ev(object, depth + 1);
        if (objTaints.length > 0) {
          const key = stringValue(args[0]);
          if (key && HOST_HEADER.test(key) && objTaints.some((t) => t.source === 'request headers')) {
            return objTaints.map((t) => ({ ...t, source: 'the Host header', ownUrl: true, line }));
          }
          // The value is read here: point the source at this line.
          return objTaints.map((t) => (t.kind === 'request' ? { ...t, line } : t));
        }
        if (/(^|\.)searchParams$/.test(objPath) || /useSearchParams\(\)$/.test(objPath)) return [{ kind: 'request', source: 'the query string', line, via: [] }];
        return [];
      }
      // Bodies of network responses: (await fetch(u)).json(), res.text()
      if (BODY_READERS.has(method)) {
        const external = this.ev(object, depth + 1).filter((t) => t.kind === 'external');
        if (external.length > 0) return external;
      }
      // Regular expression matches carry the text they matched in: /x(.*)/.exec(text)
      if (method === 'exec' && isRegexLike(object)) return this.ev(args[0], depth + 1);
      // map callbacks that ignore or cast the element: ids.map(() => '?'), ids.map(Number)
      if (method === 'map' || method === 'flatMap') {
        const effect = callbackEffect(args[0]);
        if (effect === 'drop') return [];
        const base = this.ev(object, depth + 1);
        return effect === 'number' ? base.map((t) => withVia(t, 'number')) : base;
      }
      if (PASS_THROUGH_METHODS.has(method)) {
        const out = [...this.ev(object, depth + 1)];
        if (ARGUMENT_METHODS.has(method)) for (const a of args.slice(method === 'replace' || method === 'replaceAll' || method === 'padStart' || method === 'padEnd' ? 1 : 0)) out.push(...this.ev(a, depth + 1));
        return out;
      }
    }

    // Network responses
    if (canonical === 'fetch' || canonical === 'undici#fetch' || canonical === 'node-fetch#default' || /^(axios|got|ky)(\.(get|post|put|patch|delete|request))?$/.test(canonical) || /^(axios|got|ky)#(default|get|post|put|patch|delete|request)$/.test(canonical)) {
      return [{ kind: 'external', source: 'a network response', line, via: [] }];
    }

    const bare = canonical.replace(/^[^#]*#/, '');
    // Next.js request helpers
    if (canonical.startsWith('next/headers#') && (bare === 'headers' || bare === 'cookies')) {
      return [{ kind: 'request', source: bare === 'headers' ? 'request headers' : 'cookies', line, via: [] }];
    }
    // Client routers
    if (/(^|#)useSearchParams$/.test(canonical)) return [{ kind: 'request', source: 'the query string', line, via: [] }];
    if (/(^|#)useParams$/.test(canonical)) return [{ kind: 'request', source: 'route parameters', line, via: [] }];
    if (/^(vue-router|#app|#imports|nuxt\/app|vue-router\/auto)#useRoute$/.test(canonical) || canonical === 'useRoute') return [{ kind: 'request', source: 'URL parameters', line, via: [] }];
    // h3 and Nuxt server helpers: readBody(event), getQuery(event)
    const h3 = H3_SOURCES.get(bare);
    const eventArg = unwrap(args[0]);
    const h3Event = eventArg?.type === 'Identifier' && (/^(event|e|evt|ev|h3Event)$/.test(eventArg.name) || this.isRequestObject(eventArg));
    if (h3 && h3Event && (canonical === bare || /^(h3|nitropack|nitropack\/runtime|#imports|nuxt|nuxt\/app|#app)#/.test(canonical))) {
      const t: Taint = { kind: 'request', source: h3.phrase, line, via: [] };
      if (h3.validated) {
        t.via = ['schema'];
        if (args[1]) t.schema = args[1];
      }
      if (h3.ownUrl) t.ownUrl = true;
      return [t];
    }
    if (/^hono\/cookie#get(Signed)?Cookie$/.test(canonical)) return [{ kind: 'request', source: 'cookies', line, via: [] }];

    if (canonical === 'JSON.stringify') return this.ev(args[0], depth + 1).map((t) => withVia(t, 'json'));
    if (/^marked#(marked|parse|default|marked\.parse|default\.parse)$|^marked(\.parse)?$|^snarkdown#default$|(^|\.)converter\.makeHtml$/.test(canonical)) {
      return this.ev(args[0], depth + 1).map((t) => withVia(t, 'markdown'));
    }

    // Pass-through functions keep the taint of their arguments.
    const pathLike = canonical.replace(/^[^#]+#/, (m) => (m.startsWith('path#') ? m : ''));
    if (PASS_THROUGH_FUNCTIONS.has(canonical) || PASS_THROUGH_FUNCTIONS.has(pathLike)) {
      const out: Taint[] = [];
      for (const a of args) for (const t of this.ev(a, depth + 1)) out.push(withVia(t, canonical.toLowerCase()));
      return out;
    }
    return [];
  }

  private modelTaintFor(call: CallLike, canonical: string, line: number): Taint {
    const t = this.modelTaint(line);
    const options = unwrap(call.arguments[0] as Node);
    if (/(^|[.#])(generateObject|streamObject)$/.test(canonical)) {
      const schema = objectProp(options, 'schema');
      if (schema) t.schemaAt = { key: 'object', schema };
    } else if (/(^|[.#])(generateText|streamText)$/.test(canonical)) {
      for (const key of ['output', 'experimental_output']) {
        const out = unwrap(objectProp(options, key));
        const schema = isCallNode(out) ? objectProp(out.arguments[0] as Node, 'schema') : null;
        if (schema) t.schemaAt = { key, schema };
      }
    } else if (/\.parse$/.test(canonical)) {
      const format = unwrap(objectProp(options, 'response_format') ?? objectProp(objectProp(options, 'text'), 'format'));
      const schema = isCallNode(format) ? (format.arguments[0] as Node | undefined) : undefined;
      if (schema) t.schemaAt = { key: /responses/.test(canonical) ? 'output_parsed' : 'parsed', schema };
    }
    return t;
  }

  private schemaParse(call: CallLike, canonical: string): { value: Node | undefined; schema: Node | null } | null {
    const callee = unwrap(call.callee as Node);
    const args = call.arguments as Node[];
    if (callee && isMemberNode(callee)) {
      const m = propertyName(callee);
      if (m && /^(parse|safeParse|parseAsync|safeParseAsync|validate|validateSync|validateAsync|cast|decode|assert|create)$/.test(m)) {
        const recv = unwrap(callee.object as Node);
        if (recv && this.looksLikeSchema(recv, m)) return { value: args[args.length - 1], schema: recv };
      }
    }
    if (/^(valibot|@valibot\/valibot)#(parse|safeParse|parseAsync|safeParseAsync|assert)$|^v\.(parse|safeParse|parseAsync|safeParseAsync)$/.test(canonical) && args.length >= 2) {
      return { value: args[1], schema: args[0] ?? null };
    }
    if (/(^|[.#])Value\.(Parse|Decode|Cast|Clean)$/.test(canonical) && args.length >= 2) return { value: args[args.length - 1], schema: args[0] ?? null };
    return null;
  }

  private looksLikeSchema(recv: Node, method: string): boolean {
    const path = memberPath(recv) ?? '';
    if (/^(JSON|url|qs|querystring|cookie|path|Date|YAML|yaml|marked|csv|toml|JSON5|URL|new URL\(\))$/.test(path) || /\.(url|qs|cookie)$/.test(path)) return false;
    if (isCallNode(recv)) {
      let cur: Node | null = recv;
      while (cur && isCallNode(cur) && isMemberNode(cur.callee)) cur = unwrap(cur.callee.object as Node);
      if (cur && isCallNode(cur)) cur = unwrap(cur.callee as Node);
      const root = memberPath(cur)?.split('.')[0] ?? '';
      if (/^(z|zod|v|yup|Joi|joi|t|Type|s|type|y)$/.test(root)) return true;
      return false;
    }
    if (/(schema|Schema|SCHEMA|validator|Validator|Dto|DTO)$/.test(path)) return (method !== 'create' && method !== 'decode') || /schema/i.test(path);
    if (recv.type === 'Identifier') {
      const init = unwrap(topLevelConst(this.program, recv.name));
      if (init && isCallNode(init)) {
        let cur: Node | null = init;
        while (cur && isCallNode(cur) && isMemberNode(cur.callee) && isCallNode(unwrap(cur.callee.object as Node))) cur = unwrap(cur.callee.object as Node);
        const root = isCallNode(cur) ? (memberPath(cur.callee)?.split('.')[0] ?? '') : '';
        return /^(z|zod|v|yup|Joi|joi|t|Type|s|type|y)$/.test(root);
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Function roles and parameters

  private bindParams(fn: FunctionNode, role: FunctionRole, line: number): void {
    if (role.type === 'server-action') {
      for (const param of fn.params) for (const name of bindingNames(param as Node)) this.bind(name, { taints: [{ kind: 'request', source: 'a Server Action argument', line, via: [] }] });
      return;
    }
    if (role.type === 'tool' || role.type === 'trpc') {
      const base: Taint =
        role.type === 'tool'
          ? { kind: 'tool', source: 'a tool argument chosen by the model', line, via: [] }
          : { kind: 'request', source: 'tRPC input', line, via: [] };
      if (role.schema) {
        base.via = ['schema'];
        base.schema = role.schema;
      }
      const param = fn.params[0] as Node | undefined;
      if (!param) return;
      if (role.type === 'trpc') {
        if (param.type === 'Identifier') this.bind(param.name, { taints: [], members: new Map([['input', [base]]]), membersOnly: true });
        else if (param.type === 'ObjectPattern') {
          for (const p of param.properties) {
            if (p.type === 'ObjectProperty' && keyName(p) === 'input') this.bindSchemaPattern(p.value as Node, base);
          }
        }
        return;
      }
      this.bindSchemaPattern(param, base);
      return;
    }
    if (role.type === 'mcp-request') {
      const param = fn.params[0] as Node | undefined;
      if (param?.type === 'Identifier') this.bind(param.name, { taints: [], toolRequest: { kind: 'tool', source: 'a tool argument chosen by the model', line, via: [] } });
      return;
    }
    fn.params.forEach((param, index) => {
      if (param.type === 'Identifier') {
        if (index === 0) this.bind(param.name, { taints: [], requestObject: true });
        else if (index === 1 && /^(ctx|context)$/.test(param.name)) this.bind(param.name, { taints: [], requestObject: true });
      } else if (param.type === 'ObjectPattern' || (param.type === 'AssignmentPattern' && param.left.type === 'ObjectPattern')) {
        const pattern = param.type === 'AssignmentPattern' ? param.left : param;
        if (pattern.type !== 'ObjectPattern') return;
        for (const p of pattern.properties) {
          if (p.type !== 'ObjectProperty') continue;
          const key = keyName(p);
          const names = bindingNames(p.value as Node);
          if (key === 'request' || key === 'url' || key === 'req' || key === 'event') for (const n of names) this.bind(n, { taints: [], requestObject: true });
          else if (key === 'params' || key === 'query' || key === 'searchParams' || key === 'body' || key === 'cookies' || key === 'headers') {
            const phrase = REQUEST_PROPS.get(key) ?? 'request data';
            for (const n of names) this.bind(n, { taints: [{ kind: 'request', source: phrase, line, via: [] }] });
          }
        }
      }
    });
  }

  /** Bind a parameter pattern whose value was validated by a schema (tool and tRPC arguments). */
  private bindSchemaPattern(pattern: Node, base: Taint): void {
    if (pattern.type === 'Identifier') {
      this.bind(pattern.name, { taints: [base] });
      return;
    }
    if (pattern.type === 'AssignmentPattern') {
      this.bindSchemaPattern(pattern.left as Node, base);
      return;
    }
    if (pattern.type !== 'ObjectPattern') {
      for (const n of bindingNames(pattern)) this.bind(n, { taints: [base] });
      return;
    }
    const shape = base.schema ? schemaShape(this.program, base.schema) : null;
    for (const p of pattern.properties) {
      if (p.type === 'RestElement') {
        for (const n of bindingNames(p.argument as Node)) this.bind(n, { taints: [base] });
        continue;
      }
      const key = keyName(p);
      const target = p.value as Node;
      if (key === null || !base.schema) {
        for (const n of bindingNames(target)) this.bind(n, { taints: [dropSchema(base)] });
        continue;
      }
      // Mastra passes the arguments as `context`.
      if (key === 'context' && shape && !shape.has('context')) {
        this.bindSchemaPattern(target, base);
        continue;
      }
      const taints = this.memberOf([base], key);
      if (target.type === 'ObjectPattern' && taints[0]?.schema) {
        this.bindSchemaPattern(target, taints[0]);
        continue;
      }
      for (const n of bindingNames(target)) this.bind(n, { taints });
    }
  }

  /** Iteration callbacks see the elements of the array they iterate: items.map((item) => ...). */
  private bindCallbackParams(fn: FunctionNode, parents: readonly Node[]): void {
    const parent = parents[parents.length - 1];
    if (!parent || !isCallNode(parent) || parent.arguments[0] !== fn || !isMemberNode(parent.callee)) return;
    const method = propertyName(parent.callee);
    const index = method && ELEMENT_CALLBACKS.has(method) ? 0 : method === 'reduce' || method === 'reduceRight' ? 1 : -1;
    if (index < 0) return;
    const taints = this.ev(parent.callee.object as Node, 0);
    if (taints.length === 0) return;
    const param = fn.params[index] as Node | undefined;
    if (!param) return;
    for (const name of bindingNames(param)) this.bind(name, { taints });
  }

  /** NestJS controller parameters: @Body() body, @Query('q') q, @Param('id') id. */
  private bindDecoratedParams(fn: FunctionNode, line: number): void {
    if (fn.type !== 'ClassMethod' && fn.type !== 'ClassPrivateMethod') return;
    for (const param of fn.params) {
      const target = (param.type === 'TSParameterProperty' ? param.parameter : param) as Node;
      const decorators = ((param as { decorators?: Array<{ expression: Node }> | null }).decorators ?? (target as { decorators?: Array<{ expression: Node }> | null }).decorators) ?? [];
      for (const d of decorators) {
        const expr = unwrap(d.expression);
        const call = isCallNode(expr) ? expr : null;
        const name = call ? calleeName(call.callee as Node) : expr?.type === 'Identifier' ? expr.name : null;
        if (!name) continue;
        if (name === 'Req' || name === 'Request') {
          for (const n of bindingNames(target)) this.bind(n, { taints: [], requestObject: true });
          continue;
        }
        const phrase = NEST_SOURCES.get(name);
        if (!phrase) continue;
        const pipes = (call?.arguments ?? []).map((a) => memberPath(a.type === 'NewExpression' ? (a.callee as Node) : (a as Node)) ?? '');
        if (pipes.some((p) => /Parse(Int|Float|Bool|UUID|Enum)Pipe$/.test(p))) continue;
        const annotation = (target as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation?.typeAnnotation;
        const dto = annotation?.type === 'TSTypeReference' && annotation.typeName.type === 'Identifier' && /^[A-Z]/.test(annotation.typeName.name) && !/^(String|Number|Record|Array|Partial|Express)$/.test(annotation.typeName.name);
        for (const n of bindingNames(target)) this.bind(n, { taints: [{ kind: 'request', source: phrase, line, via: dto ? ['schema'] : [] }] });
      }
    }
  }

  private functionRole(fn: FunctionNode, parents: readonly Node[]): FunctionRole | null {
    const parent = parents[parents.length - 1];
    const grand = parents[parents.length - 2];
    const name = functionName(fn, parent);

    // Inline or module-level Server Actions.
    if (fn.body.type === 'BlockStatement' && fn.body.directives?.some((d) => d.value.value === 'use server')) return { type: 'server-action' };
    if (this.serverActionsModule && fn.async && isExported(fn, parents)) return { type: 'server-action' };

    // Tool handlers the model can call.
    const tool = this.toolRole(fn, parents);
    if (tool) return tool;

    // Route handlers: export async function POST(request) / export const GET = ...
    if (name && HTTP_METHODS.has(name) && isExported(fn, parents)) return { type: 'handler' };
    if (name && /^(loader|action|clientLoader|clientAction|load|getServerSideProps|generateMetadata)$/.test(name) && isExported(fn, parents)) return { type: 'handler' };
    if (this.routeFile && name === 'handler' && isExported(fn, parents)) return { type: 'handler' };
    if (this.routeFile && isDefaultExport(fn, parents)) return { type: 'handler' };

    // Pages: export default async function Page({ params, searchParams })
    const first = fn.params[0];
    if (first?.type === 'ObjectPattern') {
      const keys = first.properties.map((p) => (p.type === 'ObjectProperty' ? keyName(p) : null));
      if (keys.includes('searchParams')) return { type: 'handler' };
      if (keys.includes('params') && isDefaultExport(fn, parents)) return { type: 'handler' };
    }

    // SvelteKit actions: export const actions = { default: async ({ request }) => ... }
    if (parent?.type === 'ObjectProperty' && grand?.type === 'ObjectExpression') {
      const owner = parents[parents.length - 3];
      if (owner?.type === 'VariableDeclarator' && owner.id.type === 'Identifier' && owner.id.name === 'actions') return { type: 'handler' };
    }

    // Callbacks: app.get('/x', (req, res) => ...), router.post(...), tRPC procedures, h3 event handlers
    if (parent && isCallNode(parent)) {
      const callee = this.imports.canonical(parent.callee as Node) ?? '';
      if (/(^|\.)(get|post|put|patch|delete|all|use|options|head|route|on)$/.test(callee) && parent.arguments.some((a) => stringValue(a as Node)?.startsWith('/'))) return { type: 'handler' };
      if (/(^|\.)(mutation|query|subscription)$/.test(callee) && /(procedure|Procedure)/.test(callee)) return { type: 'trpc', schema: trpcInputSchema(parent.callee as Node) };
      if (/(^|[.#])(defineEventHandler|eventHandler|defineCachedEventHandler|defineWebSocketHandler)$/.test(callee)) return { type: 'handler' };
    }
    // Next.js Pages API and generic handlers named req/request, unless typed as something else (FileRequest).
    if (first?.type === 'Identifier' && /^(req|request)$/.test(first.name)) {
      const annotation = (first as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation?.typeAnnotation;
      const declared = typeName(first as Node);
      if (!annotation || annotation.type === 'TSAnyKeyword' || (declared !== null && REQUEST_TYPE.test(declared))) return { type: 'handler' };
    }
    // Handlers typed as taking a request: ({ query }: Request, res: Response) => ..., (r: NextRequest) => ...
    if (first && REQUEST_TYPE.test(typeName(first as Node) ?? '')) return { type: 'handler' };
    return null;
  }

  private toolRole(fn: FunctionNode, parents: readonly Node[]): FunctionRole | null {
    const parent = parents[parents.length - 1];
    const grand = parents[parents.length - 2];
    if (parent && isCallNode(parent) && parent.arguments.includes(fn as never)) {
      const callee = this.imports.canonical(parent.callee as Node) ?? '';
      const args = parent.arguments as Node[];
      // MCP servers: server.tool(name, description?, shape?, handler), server.registerTool(name, config, handler)
      if (/(^|\.)(tool|registerTool)$/.test(callee) && isMemberNode(parent.callee) && args[args.length - 1] === (fn as Node)) {
        const receiver = memberPath(parent.callee.object as Node) ?? '';
        if (/^(server|mcp|mcpServer)$|Server$|server$/.test(receiver) || this.imports.importsModule(/^(@modelcontextprotocol\/|fastmcp|mcp-handler|@vercel\/mcp-adapter|xmcp)/)) {
          let schema: Node | null = null;
          if (/registerTool$/.test(callee)) schema = objectProp(args[1], 'inputSchema');
          else {
            for (const a of args.slice(1, -1)) {
              const u = unwrap(a);
              if (u?.type === 'ObjectExpression' && !objectProp(u, 'readOnlyHint') && !objectProp(u, 'destructiveHint') && !objectProp(u, 'title')) schema = u;
              else if (u?.type === 'Identifier' || (u && isCallNode(u))) schema = u;
            }
          }
          return { type: 'tool', schema, definition: parent };
        }
      }
      // MCP low-level servers: server.setRequestHandler(CallToolRequestSchema, async (request) => ...)
      if (/(^|\.)setRequestHandler$/.test(callee) && /CallToolRequestSchema/.test(memberPath(args[0]) ?? '')) return { type: 'mcp-request' };
      // LangChain: tool(async (input) => ..., { name, schema })
      if (/^(@langchain\/core\/tools|langchain\/tools|@langchain\/core)#tool$/.test(callee) && args[0] === (fn as Node)) {
        return { type: 'tool', schema: objectProp(args[1], 'schema'), definition: parent };
      }
    }
    if (parent?.type === 'ObjectProperty' || fn.type === 'ObjectMethod') {
      const key = fn.type === 'ObjectMethod' ? keyName(fn) : keyName(parent as Node);
      if (key === 'execute' || key === 'handler' || key === 'func' || key === 'run' || key === 'invoke') {
        const obj = fn.type === 'ObjectMethod' ? parent : grand;
        const call = fn.type === 'ObjectMethod' ? grand : parents[parents.length - 3];
        if (obj?.type !== 'ObjectExpression') return null;
        const schema = objectProp(obj, 'inputSchema') ?? objectProp(obj, 'parameters') ?? objectProp(obj, 'schema') ?? objectProp(obj, 'argsSchema') ?? objectProp(obj, 'input_schema');
        if (call && (call.type === 'CallExpression' || call.type === 'NewExpression' || call.type === 'OptionalCallExpression')) {
          const callee = this.imports.canonical((call as CallExpression | NewExpression).callee as Node) ?? '';
          if (/(^|[.#])(tool|dynamicTool|createTool|DynamicStructuredTool|DynamicTool|StructuredTool|defineTool|betaZodTool|betaTool|zodTool|addTool|createMcpTool)$/.test(callee)) {
            if (key === 'handler' && !/tool/i.test(callee)) return null;
            if (key === 'run' && !/(beta|zod)Tool|addTool/i.test(callee)) return null;
            if (key === 'invoke' && !/tool/i.test(callee)) return null;
            return { type: 'tool', schema, definition: obj };
          }
        }
        const builder = call && (call.type === 'CallExpression' || call.type === 'NewExpression' || call.type === 'OptionalCallExpression') ? (this.imports.canonical((call as CallExpression | NewExpression).callee as Node) ?? '') : '';
        const notTool = /(Step|Workflow|Job|Task|Stream|Action|Trigger|Cron)$/i.test(builder.replace(/^.*[.#]/, ''));
        if (!notTool && key === 'execute' && (objectProp(obj, 'parameters') !== null || objectProp(obj, 'inputSchema') !== null || objectProp(obj, 'description') !== null)) {
          return { type: 'tool', schema, definition: obj };
        }
      }
    }
    return null;
  }
}

const REQUEST_TYPE = /^(express\.)?(Request|NextRequest|NextApiRequest|FastifyRequest|IncomingMessage|ExpressRequest|HonoRequest|RequestEvent|APIContext|LoaderFunctionArgs|ActionFunctionArgs)$/;

/** Name of a parameter's type annotation: `Request` in `(req: Request)` or `({ query }: Request)`. */
function typeName(param: Node): string | null {
  const annotated = param.type === 'AssignmentPattern' ? (param.left as Node) : param;
  const annotation = (annotated as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation?.typeAnnotation;
  if (!annotation || annotation.type !== 'TSTypeReference') return null;
  const name = annotation.typeName;
  if (name.type === 'Identifier') return name.name;
  if (name.type === 'TSQualifiedName' && name.left.type === 'Identifier') return `${name.left.name}.${name.right.name}`;
  return null;
}

/** The schema passed to `.input()` in a tRPC procedure chain. */
function trpcInputSchema(callee: Node): Node | null {
  let cur = unwrap(isMemberNode(callee) ? (callee.object as Node) : null);
  while (cur && isCallNode(cur) && isMemberNode(cur.callee)) {
    if (propertyName(cur.callee) === 'input') return (cur.arguments[0] as Node | undefined) ?? null;
    cur = unwrap(cur.callee.object as Node);
  }
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

function isDefaultExport(_fn: FunctionNode, parents: readonly Node[]): boolean {
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

/**
 * Walk a program the way the engine does, keeping a tracker's scopes current:
 * functions are entered before their body, declarations and assignments are
 * recorded when they complete, and loop variables are bound on entry.
 */
export function walkWithTaint(
  program: BabelFile,
  tracker: TaintTracker,
  visit: { enter?(node: Node, parents: readonly Node[]): void; exit?(node: Node, parents: readonly Node[]): void } = {},
): void {
  walk(program.program, {
    enter(node, parents) {
      if (isFunctionNode(node)) tracker.enterFunction(node as FunctionNode, parents);
      if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') tracker.enterLoop(node);
      visit.enter?.(node, parents);
      return undefined;
    },
    exit(node, parents) {
      if (node.type === 'VariableDeclarator') tracker.declare(node);
      else if (node.type === 'AssignmentExpression') tracker.assign(node.left, node.right);
      visit.exit?.(node, parents);
      if (isFunctionNode(node)) tracker.exitFunction();
    },
  });
}

export type { Expression };
