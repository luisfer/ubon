import type { File as BabelFile, Node } from '@babel/types';
import { languageOf } from '../../core/files.ts';
import { isCallNode, isMemberNode, memberPath, objectProp, propertyName, stringValue, topLevelConst, unwrap } from '../../lang/js.ts';
import { isFunctionNode, walk } from '../../lang/walk.ts';
import { parseSource } from '../../lang/parse.ts';
import type { JsContext, Rule } from '../types.ts';
import { anyTaint, contextLevel, isCheckedCode, isConstantValue, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import { declarationInit, patternInit, scriptElementKind, sinksOf } from './sinks.ts';
import { htmlDirectives } from './templates.ts';

/**
 * Values rendered as HTML: dangerouslySetInnerHTML, innerHTML, outerHTML,
 * insertAdjacentHTML, document.write, Vue v-html, Svelte {@html}, Astro
 * set:html. Request data is block; any other value that is not a constant is
 * warn. Model output at these sinks is reported by llm/output-to-sink.
 */

/** Calls whose result is sanitized or escaped HTML, or developer-controlled text. */
const SAFE_HTML_CALL =
  /(^|[.#])(sanitize\w*|escape\w*|purify|filterXSS|xss|renderToString|renderToStaticMarkup|highlight|highlightAuto|codeToHtml|toHtmlString|renderSVG|t|\$t|formatMessage|translate)$|^(dompurify|isomorphic-dompurify|xss|sanitize-html|escape-html|html-escaper|serialize-javascript|devalue|@nuxt\/devalue|htmlescape|jsesc|katex|prismjs|highlight\.js|shiki|@shikijs\/[\w-]+|uqr|qrcode|qrcode-svg|qr-image|qrcode-generator)#|(^|\.)(Prism|hljs|katex|DOMPurify|purify)\.\w+$|(^|[.#])mermaid\.render$|^mermaid#(default\.)?render$/;

/** Imports of static assets bundled at build time (`import css from './x.css?inline'`). */
const ASSET_IMPORT = /\?(raw|inline)$|\.(css|scss|sass|less|svg|html?|md|txt)(\?[\w=&]*)?$/;

export function isSafeHtmlCall(canonical: string): boolean {
  return canonical !== '' && SAFE_HTML_CALL.test(canonical);
}

/** A value built only from constants and calls that produce escaped HTML. */
function safeHtml(ctx: JsContext, node: Node | null | undefined, depth = 0): boolean {
  const n = unwrap(node);
  if (!n || depth > 4) return false;
  if (isConstantValue(ctx, n)) return true;
  if (isCallNode(n)) {
    if (isSafeHtmlCall(ctx.imports.canonical(n.callee as Node) ?? '')) return true;
    // [a, b].join(''), parts.map(...).join('') built from safe parts
    return false;
  }
  if (isMemberNode(n)) {
    const obj = unwrap(n.object as Node);
    if (obj?.type === 'Identifier' && !n.computed && stateSetOnlySafe(ctx, obj.name, propertyName(n))) return true;
    // Data shipped in a package (icon SVGs such as SimpleIcons.siGithub.svg) is not user input.
    const root = memberPath(n)?.split('.')[0];
    const binding = root ? ctx.imports.bindings.get(root) : undefined;
    if (binding && !/^[./~#]|^@\//.test(binding.module) && !/\(\)/.test(memberPath(n) ?? '()')) return true;
    // A property of a variable holding escaped output: const { svg } = await mermaid.render(...), rendered.svg
    if (obj?.type === 'Identifier') {
      const init = unwrap(declarationInit(ctx, obj.name));
      if (init && isCallNode(init) && isSafeHtmlCall(ctx.imports.canonical(init.callee as Node) ?? '')) return true;
    }
    return !!obj && isCallNode(obj) && isSafeHtmlCall(ctx.imports.canonical(obj.callee as Node) ?? '');
  }
  if (n.type === 'TemplateLiteral') return n.expressions.every((e) => safeHtml(ctx, e as Node, depth + 1));
  if (n.type === 'BinaryExpression' && n.operator === '+') return safeHtml(ctx, n.left as Node, depth + 1) && safeHtml(ctx, n.right, depth + 1);
  if (n.type === 'ConditionalExpression') return safeHtml(ctx, n.consequent, depth + 1) && safeHtml(ctx, n.alternate, depth + 1);
  if (n.type === 'LogicalExpression') return safeHtml(ctx, n.left, depth + 1) && safeHtml(ctx, n.right, depth + 1);
  if (n.type === 'Identifier') {
    const binding = ctx.imports.bindings.get(n.name);
    if (binding && ASSET_IMPORT.test(binding.module)) return true;
    if (stateSetOnlySafe(ctx, n.name, null)) return true;
    const init = declarationInit(ctx, n.name) ?? topLevelConst(ctx.program, n.name);
    if (init) return safeHtml(ctx, init, depth + 1);
    // const { svg } = await mermaid.render(id, code)
    const destructured = unwrap(patternInit(ctx, n.name));
    if (destructured && isCallNode(destructured) && isSafeHtmlCall(ctx.imports.canonical(destructured.callee as Node) ?? '')) return true;
    return importedConstant(ctx, n.name);
  }
  return false;
}

/**
 * React state whose setter only ever receives escaped HTML:
 * `const [html, setHtml] = useState('')` with `setHtml(await codeToHtml(code))`
 * in an effect. `prop` is set for reads of one property of an object state.
 */
function stateSetOnlySafe(ctx: JsContext, name: string, prop: string | null): boolean {
  for (let i = ctx.parents.length - 1; i >= 0; i--) {
    const fn = ctx.parents[i] as Node;
    if (!isFunctionNode(fn)) continue;
    let setter: string | null = null;
    let initial: Node | null = null;
    walk(fn, {
      enter(node) {
        if (setter) return 'skip';
        if (node.type !== 'VariableDeclarator' || node.id.type !== 'ArrayPattern') return undefined;
        const [value, set] = node.id.elements;
        const init = unwrap(node.init as Node | null);
        if (value?.type === 'Identifier' && value.name === name && set?.type === 'Identifier' && init && isCallNode(init) && /(^|\.)useState$/.test(memberPath(init.callee as Node) ?? '')) {
          setter = set.name;
          initial = (init.arguments[0] as Node | undefined) ?? null;
        }
        return undefined;
      },
    });
    if (!setter) continue;
    const setterName: string = setter;
    const calls: Node[][] = [];
    walk(fn, {
      enter(node, parents) {
        if (!isCallNode(node)) return undefined;
        if (node.callee.type === 'Identifier' && node.callee.name === setterName) {
          // .then((html) => setHtml(html)): the argument is the value of the promise the callback is attached to.
          const arg = unwrap(node.arguments[0] as Node | undefined);
          const promised = arg?.type === 'Identifier' ? thenReceiver(parents, arg.name) : null;
          calls.push(promised ? [promised] : (node.arguments as Node[]));
        }
        // codeToHtml(code).then(setHtml): the setter receives the promise's value.
        const first = unwrap(node.arguments[0] as Node | undefined);
        if (isMemberNode(node.callee) && propertyName(node.callee) === 'then' && first?.type === 'Identifier' && first.name === setterName) {
          calls.push([node.callee.object as Node]);
        }
        return undefined;
      },
    });
    const safeArg = (arg: Node | undefined): boolean => {
      const a = unwrap(arg);
      if (!a) return true;
      if (isFunctionNode(a)) return false;
      if (prop !== null && a.type === 'ObjectExpression') return safeLocal(ctx, fn, objectProp(a, prop), 0);
      return safeLocal(ctx, fn, a, 0);
    };
    const start = unwrap(initial);
    const initialSafe = start === null || isConstantValue(ctx, start) || start.type === 'ObjectExpression';
    return calls.length > 0 && calls.every((args) => safeArg(args[0])) && initialSafe;
  }
  return false;
}

/** For a parameter of the innermost function in `parents`: the receiver of the `.then()` that function is passed to. */
function thenReceiver(parents: readonly Node[], param: string): Node | null {
  for (let i = parents.length - 1; i >= 1; i--) {
    const fn = parents[i] as Node;
    if (!isFunctionNode(fn)) continue;
    const first = (fn as { params: Node[] }).params[0];
    if (first?.type !== 'Identifier' || first.name !== param) return null;
    const call = parents[i - 1];
    if (call && isCallNode(call) && isMemberNode(call.callee) && propertyName(call.callee) === 'then' && call.arguments[0] === fn) return call.callee.object as Node;
    return null;
  }
  return null;
}

/** A function declared under `root` with this name (a function declaration or a const bound to a function). */
function localFunction(root: Node, name: string): Node | null {
  let found: Node | null = null;
  walk(root, {
    enter(node) {
      if (found) return 'skip';
      if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node;
      else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === name) {
        const init = unwrap(node.init as Node | null);
        if (init && isFunctionNode(init)) found = init;
      }
      return undefined;
    },
  });
  return found;
}

/** Return values of a function: the expression body of an arrow, or the arguments of its return statements. */
function returnValues(fn: Node): Node[] | null {
  const body = (fn as { body?: Node }).body;
  if (!body) return null;
  if (body.type !== 'BlockStatement') return [body];
  const out: Node[] = [];
  walk(body, {
    enter(node) {
      if (node !== body && isFunctionNode(node)) return 'skip';
      if (node.type === 'ReturnStatement' && node.argument) out.push(node.argument as Node);
      return undefined;
    },
  });
  return out.length > 0 ? out : null;
}

/** Safe HTML inside a component, resolving variables and local helper functions declared anywhere in it. */
function safeLocal(ctx: JsContext, fn: Node, node: Node | null | undefined, depth: number): boolean {
  const n = unwrap(node);
  if (!n || depth > 4) return false;
  if (isConstantValue(ctx, n)) return true;
  if (isCallNode(n)) {
    if (isSafeHtmlCall(ctx.imports.canonical(n.callee as Node) ?? '')) return true;
    // Cutting or trimming safe HTML keeps it safe: html.slice(start, end)
    if (isMemberNode(n.callee) && /^(slice|substring|substr|trim|trimStart|trimEnd|toString)$/.test(propertyName(n.callee) ?? '')) return safeLocal(ctx, fn, n.callee.object as Node, depth + 1);
    // A helper defined in the component: const toHtml = (json) => highlighter.codeToHtml(json, ...)
    const callee = unwrap(n.callee as Node);
    if (callee?.type !== 'Identifier') return false;
    const helper = localFunction(fn, callee.name) ?? localFunction(ctx.program.program, callee.name);
    const returns = helper ? returnValues(helper) : null;
    return returns !== null && returns.every((r) => safeLocal(ctx, helper as Node, r, depth + 1));
  }
  if (isMemberNode(n)) {
    const obj = unwrap(n.object as Node);
    return !!obj && isCallNode(obj) && isSafeHtmlCall(ctx.imports.canonical(obj.callee as Node) ?? '');
  }
  if (n.type === 'ConditionalExpression') return safeLocal(ctx, fn, n.consequent, depth + 1) && safeLocal(ctx, fn, n.alternate, depth + 1);
  if (n.type === 'LogicalExpression') return safeLocal(ctx, fn, n.left, depth + 1) && safeLocal(ctx, fn, n.right, depth + 1);
  if (n.type === 'Identifier') {
    const name = n.name;
    let init: Node | null = null;
    walk(fn, {
      enter(node) {
        if (init) return 'skip';
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === name && node.init) init = node.init as Node;
        return undefined;
      },
    });
    return init !== null && safeLocal(ctx, fn, init, depth + 1);
  }
  return false;
}

const importCache = new Map<string, boolean>();

/** An imported binding that is a constant string in the module it comes from (a theme script, an icon). */
function importedConstant(ctx: JsContext, name: string): boolean {
  const binding = ctx.imports.bindings.get(name);
  if (!binding || binding.imported === '*') return false;
  const target = ctx.project.resolveImport(ctx.file.path, binding.module);
  if (!target) return false;
  const key = `${target}\0${binding.imported}`;
  const cached = importCache.get(key);
  if (cached !== undefined) return cached;
  let result = false;
  const text = ctx.project.read(target);
  if (text) {
    const program = parseSource(text, languageOf(target)).blocks[0]?.program;
    if (program) {
      const exported = binding.imported === 'default' ? defaultExportInit(program) : topLevelConst(program, binding.imported);
      result = exported !== null && constantIn(program, exported, 0);
    }
  }
  importCache.set(key, result);
  return result;
}

function defaultExportInit(program: BabelFile): Node | null {
  for (const stmt of program.program.body) {
    if (stmt.type !== 'ExportDefaultDeclaration') continue;
    const d = stmt.declaration as Node;
    if (d.type === 'Identifier') return topLevelConst(program, d.name);
    return d;
  }
  return null;
}

function constantIn(program: BabelFile, node: Node | null, depth: number): boolean {
  const n = unwrap(node);
  if (!n || depth > 4) return false;
  if (n.type === 'StringLiteral' || n.type === 'NumericLiteral') return true;
  if (n.type === 'TemplateLiteral') return n.expressions.every((e) => constantIn(program, e as Node, depth + 1));
  if (n.type === 'BinaryExpression') return constantIn(program, n.left as Node, depth + 1) && constantIn(program, n.right, depth + 1);
  if (n.type === 'Identifier') return constantIn(program, topLevelConst(program, n.name), depth + 1);
  return false;
}

/** JSON serialization inside the value that is not escaped afterwards, which leaves '</script>' in data untouched. */
function unescapedJson(ctx: JsContext, node: Node | null | undefined, depth = 0): boolean {
  const n = unwrap(node);
  if (!n || depth > 5) return false;
  if (escapesScriptClose(n)) return false;
  if (isCallNode(n)) {
    if (memberPath(n.callee as Node) === 'JSON.stringify') return true;
    return isMemberNode(n.callee) ? unescapedJson(ctx, n.callee.object as Node, depth + 1) : false;
  }
  if (n.type === 'TemplateLiteral') return n.expressions.some((e) => unescapedJson(ctx, e as Node, depth + 1));
  if (n.type === 'BinaryExpression') return unescapedJson(ctx, n.left as Node, depth + 1) || unescapedJson(ctx, n.right, depth + 1);
  if (n.type === 'Identifier') {
    const init = declarationInit(ctx, n.name) ?? topLevelConst(ctx.program, n.name);
    return init !== null && unescapedJson(ctx, init, depth + 1);
  }
  return false;
}

/** `.replace(/</g, '\\u003c')` and similar escaping of '<' at the end of the chain. */
function escapesScriptClose(node: Node): boolean {
  const n = unwrap(node);
  if (!n || !isCallNode(n) || !isMemberNode(n.callee)) return false;
  const method = propertyName(n.callee);
  if (method !== 'replace' && method !== 'replaceAll') return false;
  const pattern = unwrap(n.arguments[0] as Node);
  const text = pattern?.type === 'RegExpLiteral' ? pattern.pattern : stringValue(pattern);
  return !!text && /</.test(text);
}

const SCRIPT_FIX = "Escape '<' in the serialized data, for example JSON.stringify(data).replace(/</g, '\\\\u003c'), or serialize it with serialize-javascript.";

export const xssHtmlSink: Rule = {
  meta: {
    id: 'web/xss-html-sink',
    level: 'warn',
    scope: 'file',
    title: 'Value rendered as HTML without sanitizing',
    summary:
      'dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, Vue v-html, Svelte {@html}, or Astro set:html with request data (block) or with any value that is not a constant (warn).',
    why: 'HTML sinks run any script or event handler inside the markup. When the markup can contain text from users, they can run code in the sessions of other users and act as them.',
    fix: 'Render the value as text, or sanitize it with DOMPurify.sanitize() or sanitize-html before rendering it as HTML.',
    cwe: ['CWE-79'],
    owasp: ['A05:2025'],
    levels:
      'block when request data reaches the HTML; warn for other values that are not constants, for unescaped JSON.stringify() output inside a <script> element, when the value passed a schema whose constraints Ubon cannot read, and in example or template folders. Constants, sanitizer output, escaped HTML (renderToString, code highlighters, QR code renderers), <style> content, and script bodies built in code are not reported. Model output at these sinks is reported by llm/output-to-sink.',
  },
  appliesTo: isCheckedCode,
  text(ctx) {
    const lang = ctx.file.lang;
    if (lang !== 'vue' && lang !== 'svelte' && lang !== 'astro') return;
    for (const d of htmlDirectives(ctx.text, lang, isSafeHtmlCall, { path: ctx.file.path, read: (p) => ctx.project.read(p) })) {
      if (d.constant || d.safe) continue;
      const live = d.taints.filter((t) => !t.via.includes('html-sanitizer') && !t.via.includes('number'));
      if (live.some((t) => t.kind === 'model' || t.kind === 'tool')) continue;
      const hit = live.find((t) => t.kind === 'request');
      if (!hit && d.taints.length > 0 && live.length === 0) continue;
      const label = d.expression.length > 40 ? `${d.expression.slice(0, 37)}...` : d.expression;
      ctx.report({
        line: d.line,
        column: d.column,
        endColumn: d.endColumn,
        message: hit ? `${d.kind} renders HTML from ${hit.source} (${label}, line ${hit.line}).` : `${d.kind} renders a value that is not a constant (${label}).`,
        level: hit ? contextLevel(ctx.file, schemaIn(hit.via) ? 'warn' : 'block') : 'warn',
        ...(hit ? { trace: [{ line: hit.line, note: `${label} comes from ${hit.source}` }, { line: d.line, note: `reaches ${d.kind}` }] } : {}),
        key: label,
      });
    }
  },
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'html') continue;
        const script = node.type === 'JSXAttribute' ? scriptElementKind(ctx) : undefined;
        const inScript = script === 'ld-json' || script === 'script';
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live);
        const value = sink.values[0] as Node;
        if (hit) {
          const label = valueLabel(ctx, hit.value, hit.taint);
          const schema = schemaChecked(hit.taint);
          ctx.report(sink.node, {
            message: inScript
              ? `${sink.name} puts ${hit.taint.source} ${where(label, hit.taint)} inside a <script> element, where '</script>' in the data ends the script.`
              : `${sink.name} ${sink.detail === 'trust' ? 'marks as trusted a value from' : 'renders HTML from'} ${hit.taint.source} ${where(label, hit.taint)}${schema ? ', checked only by a schema whose constraints Ubon cannot read' : ''}.`,
            level: contextLevel(ctx.file, schema ? 'warn' : 'block'),
            ...(inScript ? { fix: SCRIPT_FIX } : {}),
            trace: traceOf(label, hit.taint, sink),
            key: label,
          });
          continue;
        }
        // Model output and tool arguments are reported by the llm pack.
        if (live.length > 0 && live.some((l) => l.taint.kind === 'model' || l.taint.kind === 'tool')) continue;
        if (anyTaint(ctx, sink) && live.length === 0) continue;
        if (sink.values.every((v) => isConstantValue(ctx, v))) continue;
        const label = valueLabel(ctx, value);
        // Inline <style> content is CSS written by the developer (chart themes, fonts).
        if (script === 'style') continue;
        if (script) {
          // Script bodies built in code are the developer's; embedded JSON data is what can end the element early.
          if (unescapedJson(ctx, value)) {
            ctx.report(sink.node, {
              message: `JSON.stringify(${label}) output is placed inside a <script> element, where a '</script>' in the data ends the script.`,
              level: 'warn',
              fix: SCRIPT_FIX,
              key: label,
            });
          }
          continue;
        }
        if (sink.values.every((v) => safeHtml(ctx, v))) continue;
        ctx.report(sink.node, {
          message: `${sink.name} ${sink.detail === 'trust' ? 'marks as trusted' : 'renders'} a value that is not a constant (${label}).`,
          level: 'warn',
          key: label,
        });
      }
    });
  },
};

function schemaIn(via: string[]): boolean {
  return via.includes('schema');
}
