import type { ArrayExpression, AssignmentExpression, JSXAttribute, Node, ObjectProperty } from '@babel/types';
import {
  boolValue,
  calleeName,
  isCallNode,
  isMemberNode,
  keyName,
  memberPath,
  objectProp,
  propertyName,
  stringValue,
  unwrap,
} from '../../lang/js.ts';
import type { JsContext } from '../types.ts';

/**
 * The sink catalog shared by the web and llm packs. A sink is a call,
 * assignment, or JSX attribute whose input is interpreted: as SQL, a shell
 * command, code, HTML, a file path, a URL to fetch, or a redirect target.
 * Rules ask which sinks a node is and then look at the taint of `values`.
 */

export type SinkCategory = 'sql' | 'command' | 'code' | 'html' | 'file-read' | 'file-write' | 'fetch' | 'redirect';

export type SinkDetail =
  | 'shell'
  | 'program'
  | 'eval'
  | 'function'
  | 'vm'
  | 'timer'
  | 'import'
  | 'require'
  | 'template'
  | 'script'
  | 'ld-json'
  | 'client-router'
  | 'location'
  /** Angular bypassSecurityTrust*: the value is marked as trusted markup, a URL, or a script. */
  | 'trust'
  /** dangerouslySetInnerHTML on a <style> element: the content is CSS. */
  | 'style'
  /** A command string split into program and arguments without a shell (execaCommand). */
  | 'argv';

export interface Sink {
  category: SinkCategory;
  /** Name for messages: "fetch()", "prisma.$queryRawUnsafe()", "innerHTML". */
  name: string;
  /** Node to report at. */
  node: Node;
  /** Expressions whose value the sink interprets. */
  values: Node[];
  detail?: SinkDetail;
  /** For file sinks: the fs method (readFile, unlink, rename). */
  method?: string;
}

const CACHE = new WeakMap<object, Sink[]>();
const NONE: Sink[] = [];
const ASSIGNED_SINKS = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'href', 'location']);
const NEW_SINKS = /(^|\.)(Function|Script|SourceTextModule|Response|NextResponse)$/;

/** Cheap checks that rule out most nodes before classification. */
function mayBeSink(node: Node): boolean {
  switch (node.type) {
    case 'ObjectProperty':
      return keyName(node) === 'dangerouslySetInnerHTML';
    case 'JSXAttribute':
      return node.name.type === 'JSXIdentifier' && node.name.name === 'dangerouslySetInnerHTML';
    case 'AssignmentExpression': {
      const left = node.left as Node;
      if (left.type === 'Identifier') return left.name === 'location';
      return isMemberNode(left) && ASSIGNED_SINKS.has(propertyName(left) ?? '');
    }
    case 'NewExpression':
      return NEW_SINKS.test(memberPath(node.callee as Node) ?? '');
    default:
      return true;
  }
}

/** Every sink a node is (usually zero or one). Results are cached per node. */
export function sinksOf(ctx: JsContext, node: Node): Sink[] {
  if (!mayBeSink(node)) return NONE;
  const cached = CACHE.get(node);
  if (cached) return cached;
  let out: Sink[] = [];
  try {
    out = classify(ctx, node);
  } finally {
    CACHE.set(node, out);
  }
  return out;
}

function classify(ctx: JsContext, node: Node): Sink[] {
  switch (node.type) {
    case 'CallExpression':
    case 'OptionalCallExpression':
      return callSinks(ctx, node);
    case 'NewExpression':
      return newSinks(ctx, node);
    case 'ImportExpression': {
      const source = (node as { source?: Node }).source;
      return source ? [{ category: 'code', name: 'import()', node, values: [source], detail: 'import' }] : [];
    }
    case 'AssignmentExpression':
      return assignmentSinks(node);
    case 'JSXAttribute':
      return jsxSinks(node);
    case 'ObjectProperty':
      return objectPropertySinks(node);
    default:
      return [];
  }
}

/** Short display name for a callee: `prisma.$queryRawUnsafe()`, `exec()`. */
function displayName(callee: Node): string {
  const path = memberPath(callee);
  if (!path) return `${calleeName(callee) ?? 'call'}()`;
  const parts = path.replace(/\(\)/g, '').split('.');
  const take = parts.length > 2 && /^(promises|default)$/.test(parts[parts.length - 2] as string) ? 3 : 2;
  return `${parts.slice(-take).join('.')}()`;
}

// ---------------------------------------------------------------------------
// Calls

function callSinks(ctx: JsContext, node: Node): Sink[] {
  const call = node as { callee: Node; arguments: Node[] };
  const callee = call.callee;
  if (callee.type === 'Import') {
    const source = call.arguments[0];
    return source ? [{ category: 'code', name: 'import()', node, values: [source], detail: 'import' }] : [];
  }
  const canonical = ctx.imports.canonical(callee) ?? indirectEval(callee) ?? '';
  const out: Sink[] = [];
  // Messages name the callee as it is written in the code (execAsync(), db.query()).
  const push = (s: Sink | null) => {
    if (s && s.values.length > 0) out.push(s.name.includes("('Location')") ? s : { ...s, name: displayName(callee) });
  };
  push(codeCall(ctx, node, canonical, call.arguments));
  push(commandCall(node, canonical, call.arguments));
  if (out.length === 0) push(sqlCall(ctx, node, callee, canonical, call.arguments));
  push(fileCall(ctx, node, callee, canonical, call.arguments));
  push(fetchCall(ctx, node, canonical, call.arguments));
  push(htmlCall(node, callee, canonical, call.arguments));
  push(redirectCall(ctx, node, callee, canonical, call.arguments));
  return out;
}

/** `(0, eval)(x)` */
function indirectEval(callee: Node): string | null {
  const n = unwrap(callee);
  if (n?.type === 'SequenceExpression') {
    const last = n.expressions[n.expressions.length - 1];
    if (last?.type === 'Identifier' && last.name === 'eval') return 'eval';
  }
  return null;
}

function codeCall(ctx: JsContext, node: Node, canonical: string, args: Node[]): Sink | null {
  const arg = args[0];
  if (!arg) return null;
  if (canonical === 'eval' || /^(window|globalThis|self|global)\.eval$/.test(canonical)) return { category: 'code', name: 'eval()', node, values: [arg], detail: 'eval' };
  if (canonical === 'Function' || /^(window|globalThis|self|global)\.Function$/.test(canonical)) return { category: 'code', name: 'Function()', node, values: args, detail: 'function' };
  if (/^vm#(runInNewContext|runInThisContext|runInContext|compileFunction)$/.test(canonical)) return { category: 'code', name: `vm.${canonical.slice(3)}()`, node, values: [arg], detail: 'vm' };
  if (/^((window|globalThis|self|global)\.)?(setTimeout|setInterval)$/.test(canonical) || /^timers#(setTimeout|setInterval)$/.test(canonical)) {
    const u = unwrap(arg);
    if (u && u.type !== 'ArrowFunctionExpression' && u.type !== 'FunctionExpression') return { category: 'code', name: `${canonical.replace(/^.*[.#]/, '')}()`, node, values: [arg], detail: 'timer' };
    return null;
  }
  if (canonical === 'require' && stringValue(arg) === null && !ctx.imports.bindings.has('require')) return { category: 'code', name: 'require()', node, values: [arg], detail: 'require' };
  if (/^(lodash|lodash-es|underscore)#template$|^lodash\.template#default$|^_\.template$|^ejs#(render|compile)$|^pug#(render|compile)$|^nunjucks#renderString$|^handlebars#(compile|default\.compile)$|^Handlebars\.compile$/.test(canonical)) {
    return { category: 'code', name: `${canonical.replace(/^.*#/, '').replace(/^default\./, '')}()`, node, values: [arg], detail: 'template' };
  }
  return null;
}

const SHELL_PROGRAM = /^(\/usr)?(\/bin\/)?(sh|bash|zsh|dash|ksh|fish|cmd|cmd\.exe|powershell|powershell\.exe|pwsh)$/;
const SHELL_FLAG = /^(-c|-lc|-ic|-cl|\/c|\/C|\/k|-Command|-command|-EncodedCommand)$/;

function arrayItems(node: Node | undefined): Node[] | null {
  const n = unwrap(node);
  if (!n || n.type !== 'ArrayExpression') return null;
  return n.elements.filter((e): e is NonNullable<typeof e> => e !== null) as Node[];
}

function commandCall(node: Node, canonical: string, args: Node[]): Sink | null {
  const fn = canonical.replace(/^.*#/, '');
  if (/^child_process#(exec|execSync)$/.test(canonical) || /^shelljs#(exec|default\.exec)$/.test(canonical)) {
    return args[0] ? { category: 'command', name: `${fn.replace(/^default\./, '')}()`, node, values: [args[0]], detail: 'shell' } : null;
  }
  if (/^execa#(execaCommand|execaCommandSync)$/.test(canonical)) return args[0] ? { category: 'command', name: `${fn}()`, node, values: [args[0]], detail: 'argv' } : null;
  const spawnLike =
    /^child_process#(spawn|spawnSync|execFile|execFileSync)$/.test(canonical) ||
    /^cross-spawn#(default|spawn|sync)$/.test(canonical) ||
    /^execa#(execa|default|execaSync|execaNode)$/.test(canonical);
  if (spawnLike) return spawnSink(node, `${fn === 'default' ? canonical.replace(/#.*/, '') : fn}()`, args[0], args[1], args[2]);
  if (canonical === 'Bun.spawn' || canonical === 'Bun.spawnSync') {
    const first = unwrap(args[0]);
    const cmd = first?.type === 'ObjectExpression' ? objectProp(first, 'cmd') : first;
    const items = arrayItems(cmd as Node | undefined);
    if (!items || items.length === 0) return cmd ? { category: 'command', name: `${canonical}()`, node, values: [cmd as Node], detail: 'program' } : null;
    const rest: ArrayExpression = { type: 'ArrayExpression', elements: items.slice(1) as ArrayExpression['elements'] };
    return spawnSink(node, `${canonical}()`, items[0], rest, undefined);
  }
  return null;
}

function spawnSink(node: Node, name: string, program: Node | undefined, second: Node | undefined, third: Node | undefined): Sink | null {
  if (!program) return null;
  const list = arrayItems(second);
  const options = list ? third : unwrap(second)?.type === 'ObjectExpression' ? second : third;
  const shell = objectProp(options, 'shell');
  if (shell && boolValue(shell) !== false) return { category: 'command', name, node, values: [program, ...(list ?? [])], detail: 'shell' };
  const programText = stringValue(program);
  if (programText && SHELL_PROGRAM.test(programText) && list) {
    const flag = list.findIndex((e) => SHELL_FLAG.test(stringValue(e) ?? ''));
    const script = flag >= 0 ? list[flag + 1] : undefined;
    if (script) return { category: 'command', name, node, values: [script], detail: 'shell' };
  }
  return { category: 'command', name, node, values: [program], detail: 'program' };
}

const RAW_SQL = /^\$(queryRawUnsafe|executeRawUnsafe)$/;
const KNEX_RAW = /^(whereRaw|orWhereRaw|andWhereRaw|havingRaw|orHavingRaw|andHavingRaw|orderByRaw|groupByRaw|joinRaw|fromRaw|selectRaw|onRaw)$/;
const QUERY_METHODS = new Set(['query', 'execute', 'exec', 'prepare', 'run', 'all', 'get', 'each', 'many', 'one', 'none', 'any', 'oneOrNone', 'manyOrNone', 'result', 'queryObject', 'queryArray', 'execSQL', 'executeSql']);
const STRONG_METHODS = new Set(['query', 'execute', 'exec', 'prepare', 'many', 'one', 'none', 'any', 'oneOrNone', 'manyOrNone', 'result', 'queryObject', 'queryArray', 'execSQL', 'executeSql']);
const DB_RECEIVER =
  /(^|\.)(db|database|pool|client|conn|connection|knex|sequelize|pg|mysql|sqlite|sqlite3|sql|tx|trx|transaction|queryRunner|manager|entityManager|em|dataSource|d1|DB|turso|libsql|postgres|mssql|pgp)$|(Db|DB|Pool|Client|Connection|Database|Sql|SQL|Tx|Trx)$/;
const SQL_START = /^\s*\(?\s*(select|insert|update|delete|with|replace|merge|create|drop|alter|truncate|call|exec|execute|pragma|show|describe|explain|upsert|grant|revoke|copy)\b/i;
const SQL_ANY = /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\S+\s+set\b|\bdelete\s+from\b|\bwhere\s+[\w."`[\]]+\s*(=|<>|!=|<|>|\blike\b|\bilike\b|\bin\b)|\border\s+by\b|\bgroup\s+by\b/i;

function sqlCall(ctx: JsContext, node: Node, callee: Node, canonical: string, args: Node[]): Sink | null {
  const c = unwrap(callee);
  const arg = args[0];
  if (!arg || !c) return null;
  if (!isMemberNode(c)) {
    if (/^sequelize#literal$/.test(canonical)) return { category: 'sql', name: 'literal()', node, values: [arg] };
    return null;
  }
  const method = propertyName(c) ?? '';
  const receiver = memberPath(c.object as Node) ?? '';
  const name = displayName(c);
  if (RAW_SQL.test(method)) return { category: 'sql', name, node, values: [arg] };
  if (method === 'raw' && /(^|\.)(sql|Prisma|knex|db|trx|tx|database|kysely|client|qb|queryBuilder)$/.test(receiver)) return { category: 'sql', name, node, values: [arg] };
  if (method === 'unsafe' && /(^|\.)(sql|db|pg|postgres|database|client|tx)$/.test(receiver)) return { category: 'sql', name, node, values: [arg] };
  if (KNEX_RAW.test(method)) return { category: 'sql', name, node, values: [arg] };
  if (method === 'literal' && (/(^|\.)(sequelize|Sequelize)$/.test(receiver) || /^sequelize#/.test(canonical))) return { category: 'sql', name, node, values: [arg] };
  if (/^(where|andWhere|orWhere|having|andHaving|orHaving|orderBy|addOrderBy|groupBy|addGroupBy|select|addSelect)$/.test(method) && chainCalls(c.object as Node, 'createQueryBuilder')) {
    return { category: 'sql', name, node, values: [arg] };
  }
  if (!QUERY_METHODS.has(method)) return null;
  if (/^child_process#/.test(canonical) || isRegexReceiver(c.object as Node)) return null;
  let text: Node | null = arg;
  const u = unwrap(arg);
  if (u?.type === 'ObjectExpression') text = objectProp(u, 'text') ?? objectProp(u, 'sql') ?? null;
  if (!text) return null;
  const sqlLike = looksLikeSql(ctx, text, 0);
  const strong = STRONG_METHODS.has(method) && DB_RECEIVER.test(receiver);
  if (sqlLike === true || (sqlLike === null && strong)) return { category: 'sql', name, node, values: [text] };
  return null;
}

function chainCalls(node: Node, method: string): boolean {
  let cur = unwrap(node);
  for (let i = 0; cur && i < 20; i++) {
    if (isCallNode(cur)) {
      if (calleeName(cur.callee as Node) === method) return true;
      cur = isMemberNode(cur.callee) ? unwrap(cur.callee.object as Node) : null;
    } else if (isMemberNode(cur)) cur = unwrap(cur.object as Node);
    else return false;
  }
  return false;
}

function isRegexReceiver(node: Node): boolean {
  const n = unwrap(node);
  return n?.type === 'RegExpLiteral' || (n?.type === 'NewExpression' && memberPath(n.callee as Node) === 'RegExp');
}

/**
 * True when the static text of a SQL argument looks like SQL, false when it
 * has text that does not, null when there is no static text to judge.
 */
export function looksLikeSql(ctx: JsContext, node: Node, depth: number): boolean | null {
  const n = unwrap(node);
  if (!n || depth > 3) return null;
  const text = staticText(n);
  if (text !== null) {
    if (text.trim() === '') return null;
    return SQL_START.test(text) || SQL_ANY.test(text);
  }
  if (n.type === 'Identifier') {
    const init = declarationInit(ctx, n.name);
    return init ? looksLikeSql(ctx, init, depth + 1) : null;
  }
  return null;
}

function staticText(n: Node): string | null {
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral') return n.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' ');
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const parts: string[] = [];
    const collect = (x: Node) => {
      const u = unwrap(x) ?? x;
      if (u.type === 'BinaryExpression' && u.operator === '+') {
        collect(u.left as Node);
        collect(u.right);
      } else if (u.type === 'StringLiteral') parts.push(u.value);
      else if (u.type === 'TemplateLiteral') parts.push(u.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' '));
      else parts.push(' ');
    };
    collect(n);
    return parts.join('');
  }
  return null;
}

/** Initializer of a destructuring declaration that binds `name`: `const { svg } = await render(...)` gives the call. */
export function patternInit(ctx: JsContext, name: string): Node | null {
  const parents = ctx.parents;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type !== 'BlockStatement' && p.type !== 'Program' && p.type !== 'StaticBlock') continue;
    for (const stmt of (p as { body: Node[] }).body) {
      const decl = stmt.type === 'ExportNamedDeclaration' ? (stmt.declaration as Node | null) : stmt;
      if (decl?.type !== 'VariableDeclaration') continue;
      for (const d of decl.declarations) {
        if (d.id.type !== 'ObjectPattern' && d.id.type !== 'ArrayPattern') continue;
        if (d.init && patternBinds(d.id as Node, name)) return d.init as Node;
      }
    }
  }
  return null;
}

function patternBinds(pattern: Node, name: string): boolean {
  switch (pattern.type) {
    case 'Identifier':
      return pattern.name === name;
    case 'ObjectPattern':
      return pattern.properties.some((p) => patternBinds((p.type === 'RestElement' ? p.argument : p.value) as Node, name));
    case 'ArrayPattern':
      return pattern.elements.some((e) => e !== null && patternBinds(e as Node, name));
    case 'AssignmentPattern':
      return patternBinds(pattern.left as Node, name);
    case 'RestElement':
      return patternBinds(pattern.argument as Node, name);
    default:
      return false;
  }
}

/** Initializer of the nearest declaration of `name` visible from the current node (same function or module). */
export function declarationInit(ctx: JsContext, name: string): Node | null {
  const parents = ctx.parents;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type !== 'BlockStatement' && p.type !== 'Program' && p.type !== 'StaticBlock') continue;
    for (const stmt of (p as { body: Node[] }).body) {
      const decl = stmt.type === 'ExportNamedDeclaration' ? (stmt.declaration as Node | null) : stmt;
      if (decl?.type !== 'VariableDeclaration') continue;
      for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.id.name === name && d.init) return d.init as Node;
    }
  }
  return null;
}

const FS_READ = new Set([
  'readFile', 'readFileSync', 'createReadStream', 'readdir', 'readdirSync', 'opendir', 'opendirSync', 'readlink', 'readlinkSync', 'open',
  'openSync', 'readJson', 'readJSON', 'readJsonSync', 'readJSONSync', 'openAsBlob',
]);
const FS_WRITE = new Set([
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'mkdir', 'mkdirSync', 'rename', 'renameSync', 'copyFile',
  'copyFileSync', 'cp', 'cpSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'truncate',
  'truncateSync', 'outputFile', 'outputFileSync', 'outputJson', 'outputJSON', 'outputJsonSync', 'writeJson', 'writeJSON', 'writeJsonSync',
  'move', 'moveSync', 'copy', 'copySync', 'ensureFile', 'ensureFileSync', 'mkdirp', 'mkdirs', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir',
  'rmdirSync', 'remove', 'removeSync', 'emptyDir', 'emptyDirSync',
]);
const TWO_PATHS = new Set(['rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'symlink', 'symlinkSync', 'link', 'linkSync', 'move', 'moveSync', 'copy', 'copySync']);

function fileCall(ctx: JsContext, node: Node, callee: Node, canonical: string, args: Node[]): Sink | null {
  const arg = args[0];
  if (!arg) return null;
  const m = /^(fs|fs-extra|graceful-fs|original-fs)#(.+)$/.exec(canonical);
  if (m) {
    const method = (m[2] as string).replace(/^default\./, '');
    const values = TWO_PATHS.has(method) && args[1] ? [arg, args[1]] : [arg];
    if (FS_READ.has(method)) return { category: 'file-read', name: `fs.${method}()`, node, values, method };
    if (FS_WRITE.has(method)) return { category: 'file-write', name: `fs.${method}()`, node, values, method };
    return null;
  }
  if (canonical === 'Bun.file') return { category: 'file-read', name: 'Bun.file()', node, values: [arg] };
  if (canonical === 'Bun.write') return { category: 'file-write', name: 'Bun.write()', node, values: [arg] };
  if (/^(rimraf#(default|rimraf|sync|rimrafSync)|del#(default|deleteAsync|deleteSync)|trash#default)$/.test(canonical)) return { category: 'file-write', name: `${canonical.replace(/#.*/, '')}()`, node, values: [arg], method: 'rm' };
  const c = unwrap(callee);
  if (c && isMemberNode(c)) {
    const method = propertyName(c);
    const receiver = memberPath(c.object as Node) ?? '';
    if ((method === 'sendFile' || method === 'download') && /^(res|response|resp)$/.test(receiver)) {
      // With the `root` option, Express rejects paths that leave the root.
      const opts = unwrap(args[1]);
      if (method === 'sendFile' && opts?.type === 'ObjectExpression' && objectProp(opts, 'root')) return null;
      return { category: 'file-read', name: `res.${method}()`, node, values: [arg] };
    }
  }
  void ctx;
  return null;
}

function fetchCall(ctx: JsContext, node: Node, canonical: string, args: Node[]): Sink | null {
  const arg = args[0];
  if (!arg) return null;
  const urlOf = (x: Node): Node[] => {
    const u = unwrap(x);
    if (u?.type === 'ObjectExpression') return [objectProp(u, 'url'), objectProp(u, 'uri'), objectProp(u, 'baseURL'), objectProp(u, 'prefixUrl')].filter((v): v is Node => v !== null);
    return [x];
  };
  if (
    canonical === 'fetch' ||
    /^(window|globalThis|self|global)\.fetch$/.test(canonical) ||
    /^(node-fetch|cross-fetch|isomorphic-fetch|isomorphic-unfetch|undici)#(default|fetch|request|stream)$/.test(canonical) ||
    /^ofetch#(ofetch|\$fetch|default)$/.test(canonical) ||
    canonical === '$fetch'
  ) {
    return { category: 'fetch', name: `${canonical.replace(/^.*[#.]/, '').replace(/^default$/, 'fetch')}()`, node, values: urlOf(arg) };
  }
  const client = /^(axios|got|ky|superagent|request|phin|bent|wretch|needle)(#(default|get|post|put|patch|delete|head|options|request|stream|postForm|putForm|patchForm)|\.(get|post|put|patch|delete|head|options|request))?$/.exec(canonical);
  if (client && (canonical.includes('#') || /^(axios|got|ky)(\.|$)/.test(canonical))) {
    const lib = client[1] as string;
    const method = client[3] ?? client[4] ?? 'default';
    if (lib === 'needle' && method === 'default') return args[1] ? { category: 'fetch', name: 'needle()', node, values: [args[1]] } : null;
    return { category: 'fetch', name: method === 'default' ? `${lib}()` : `${lib}.${method}()`, node, values: urlOf(arg) };
  }
  const http = /^(http|https|http2)#(get|request|connect)$/.exec(canonical);
  if (http) {
    const u = unwrap(arg);
    const values = u?.type === 'ObjectExpression' ? [objectProp(u, 'host'), objectProp(u, 'hostname')].filter((v): v is Node => v !== null) : [arg];
    return { category: 'fetch', name: `${http[1]}.${http[2]}()`, node, values };
  }
  if (/(^|\.)page\.goto$/.test(canonical) && ctx.imports.importsModule(/^(puppeteer|puppeteer-core|playwright|playwright-core|@playwright\/test)$/)) {
    return { category: 'fetch', name: 'page.goto()', node, values: [arg] };
  }
  return null;
}

function htmlCall(node: Node, callee: Node, canonical: string, args: Node[]): Sink | null {
  const c = unwrap(callee);
  if (!c || !isMemberNode(c)) return null;
  const method = propertyName(c);
  if (method === 'insertAdjacentHTML' && args[1]) return { category: 'html', name: 'insertAdjacentHTML()', node, values: [args[1]] };
  if ((method === 'setHTMLUnsafe' || method === 'createContextualFragment') && args[0]) return { category: 'html', name: `${method}()`, node, values: [args[0]] };
  // Angular: this.sanitizer.bypassSecurityTrustHtml(value) turns off Angular's own escaping.
  if (method && /^bypassSecurityTrust(Html|Script|Url|ResourceUrl|Style)$/.test(method) && args[0]) return { category: 'html', name: `${method}()`, node, values: [args[0]], detail: 'trust' };
  if (/^(window\.)?document\.(write|writeln)$/.test(canonical) && args.length > 0) return { category: 'html', name: `document.${method}()`, node, values: args };
  return null;
}

const RESPONSE_RECEIVER = /^(res|response|resp|reply|ctx|c|context|h|event)$/;

function redirectCall(ctx: JsContext, node: Node, callee: Node, canonical: string, args: Node[]): Sink | null {
  const arg = args[0];
  if (!arg) return null;
  if (/^next\/navigation#(redirect|permanentRedirect)$/.test(canonical)) return { category: 'redirect', name: `${canonical.slice(canonical.indexOf('#') + 1)}()`, node, values: [arg] };
  if (/^(@remix-run\/(node|server-runtime|cloudflare|deno|router)|react-router|react-router-dom|@react-router\/(node|cloudflare|architect))#(redirect|redirectDocument|replace)$/.test(canonical)) {
    return { category: 'redirect', name: `${canonical.slice(canonical.indexOf('#') + 1)}()`, node, values: [arg] };
  }
  if (canonical === '@sveltejs/kit#redirect') {
    const target = args.length >= 2 ? args[1] : args[0];
    return target ? { category: 'redirect', name: 'redirect()', node, values: [target] } : null;
  }
  if (/^(next\/server#)?NextResponse\.redirect$|^Response\.redirect$/.test(canonical)) return { category: 'redirect', name: `${canonical.replace(/^.*#/, '')}()`, node, values: [arg] };
  const c = unwrap(callee);
  if (!c || !isMemberNode(c)) return null;
  const method = propertyName(c);
  const receiver = memberPath(c.object as Node) ?? '';
  if (method === 'redirect' && RESPONSE_RECEIVER.test(receiver)) {
    const values = args.filter((a) => unwrap(a)?.type !== 'NumericLiteral');
    return values.length > 0 ? { category: 'redirect', name: `${receiver}.redirect()`, node, values } : null;
  }
  if ((method === 'push' || method === 'replace') && /(^|\.)router$/.test(receiver)) return { category: 'redirect', name: `router.${method}()`, node, values: [arg], detail: 'client-router' };
  if ((method === 'assign' || method === 'replace') && /^((window|document|self|top|globalThis)\.)?location$/.test(receiver)) {
    return { category: 'redirect', name: `location.${method}()`, node, values: [arg], detail: 'location' };
  }
  if ((method === 'setHeader' || method === 'set' || method === 'header' || method === 'append') && /^location$/i.test(stringValue(arg) ?? '') && args[1]) {
    return { category: 'redirect', name: `${method}('Location')`, node, values: [args[1]] };
  }
  if (method === 'writeHead') {
    const headers = unwrap(args[1]);
    const location = objectProp(headers, 'Location') ?? objectProp(headers, 'location');
    if (location) return { category: 'redirect', name: 'writeHead()', node, values: [location] };
  }
  void ctx;
  return null;
}

// ---------------------------------------------------------------------------
// new expressions

function newSinks(ctx: JsContext, node: Node): Sink[] {
  const n = node as { callee: Node; arguments: Node[] };
  const canonical = ctx.imports.canonical(n.callee) ?? '';
  const arg = n.arguments[0];
  if (canonical === 'Function' || /^(window|globalThis|self|global)\.Function$/.test(canonical)) {
    return n.arguments.length > 0 ? [{ category: 'code', name: 'new Function()', node, values: n.arguments, detail: 'function' }] : [];
  }
  if (/^vm#(Script|SourceTextModule)$/.test(canonical) && arg) return [{ category: 'code', name: `new vm.${canonical.slice(3)}()`, node, values: [arg], detail: 'vm' }];
  if (/^(Response|NextResponse|next\/server#NextResponse)$/.test(canonical)) {
    const init = unwrap(n.arguments[1]);
    const headers = unwrap(objectProp(init, 'headers'));
    const location = objectProp(headers, 'Location') ?? objectProp(headers, 'location');
    if (location) return [{ category: 'redirect', name: 'Location header', node, values: [location] }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Assignments, JSX, and object properties

function assignmentSinks(node: AssignmentExpression): Sink[] {
  const left = node.left as Node;
  if (node.operator !== '=' && node.operator !== '+=') return [];
  if (isMemberNode(left)) {
    const prop = propertyName(left);
    if (prop === 'innerHTML' || prop === 'outerHTML' || prop === 'srcdoc') return [{ category: 'html', name: prop, node, values: [node.right] }];
    const path = memberPath(left) ?? '';
    if (/^((window|document|self|top|globalThis)\.)?location(\.href)?$|^(window\.)?document\.location(\.href)?$/.test(path) && path !== 'location.hash') {
      return [{ category: 'redirect', name: path.replace(/^window\./, ''), node, values: [node.right], detail: 'location' }];
    }
  }
  if (left.type === 'Identifier' && left.name === 'location') return [{ category: 'redirect', name: 'location', node, values: [node.right], detail: 'location' }];
  return [];
}

function jsxSinks(node: JSXAttribute): Sink[] {
  if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'dangerouslySetInnerHTML') return [];
  const container = node.value;
  if (!container || container.type !== 'JSXExpressionContainer' || container.expression.type === 'JSXEmptyExpression') return [];
  const expr = container.expression as Node;
  const html = objectProp(expr, '__html');
  const values = [html ?? expr];
  return [{ category: 'html', name: 'dangerouslySetInnerHTML', node, values }];
}

function objectPropertySinks(node: ObjectProperty): Sink[] {
  if (keyName(node) !== 'dangerouslySetInnerHTML') return [];
  const value = unwrap(node.value as Node);
  if (!value || value.type !== 'ObjectExpression') return [];
  const html = objectProp(value, '__html');
  return html ? [{ category: 'html', name: 'dangerouslySetInnerHTML', node, values: [html] }] : [];
}

/** For a dangerouslySetInnerHTML attribute: 'ld-json' or 'script' on a <script> element, 'style' on a <style> element. */
export function scriptElementKind(ctx: JsContext): SinkDetail | undefined {
  const opening = ctx.parents[ctx.parents.length - 1];
  if (!opening || opening.type !== 'JSXOpeningElement') return undefined;
  const name = opening.name.type === 'JSXIdentifier' ? opening.name.name : opening.name.type === 'JSXMemberExpression' ? opening.name.property.name : '';
  if (name === 'style') return 'style';
  if (name !== 'script' && name !== 'Script') return undefined;
  for (const a of opening.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier' || a.name.name !== 'type') continue;
    const v = a.value;
    const text = v?.type === 'StringLiteral' ? v.value : v?.type === 'JSXExpressionContainer' ? stringValue(v.expression as Node) : null;
    if (text && /ld\+json/i.test(text)) return 'ld-json';
  }
  return 'script';
}
