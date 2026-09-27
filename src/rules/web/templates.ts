import { parseExpression } from '@babel/parser';
import type { Node } from '@babel/types';
import { lineStarts, offsetToPosition } from '../../core/files.ts';
import { maskComments } from '../../lang/comments.ts';
import {
  ImportMap,
  type Taint,
  TaintTracker,
  isCallNode,
  isConstantExpression,
  isMemberNode,
  keyName,
  memberPath,
  propertyName,
  topLevelConst,
  unwrap,
  walkWithTaint,
} from '../../lang/js.ts';
import { parseSource } from '../../lang/parse.ts';
import { isFunctionNode } from '../../lang/walk.ts';

/**
 * HTML directives in component templates: Vue `v-html` (and `:innerHTML`),
 * Svelte `{@html ...}`, Astro `set:html`. The template sits outside the script
 * blocks the engine parses, so the directives are found in the template text
 * and their expressions are evaluated against the scope of the component's
 * script blocks.
 */

export interface HtmlDirective {
  kind: 'v-html' | ':innerHTML' | '{@html}' | 'set:html';
  line: number;
  column: number;
  endColumn: number;
  /** Source text of the expression. */
  expression: string;
  /** Parsed expression, or null when it does not parse. */
  node: Node | null;
  /** A literal or a module constant. */
  constant: boolean;
  /** A sanitizer or a producer of escaped HTML at the top of the expression. */
  safe: boolean;
  taints: Taint[];
}

type ComponentLang = 'vue' | 'svelte' | 'astro';

interface Analyzed {
  programs: Array<{ tracker: TaintTracker; imports: ImportMap; program: import('@babel/types').File }>;
}

/** Where the component lives, to find SvelteKit's sibling server file. */
export interface ComponentFile {
  path: string;
  read(path: string): string | null;
}

let cache: { text: string; lang: string; path: string; result: HtmlDirective[] } | null = null;

/** Every HTML directive in a component file, with its taint. */
export function htmlDirectives(text: string, lang: ComponentLang, isSafeCall: (canonical: string) => boolean, file?: ComponentFile): HtmlDirective[] {
  const path = file?.path ?? '';
  if (cache && cache.text === text && cache.lang === lang && cache.path === path) return cache.result;
  const result = scan(text, lang, isSafeCall, file);
  cache = { text, lang, path, result };
  return result;
}

/**
 * SvelteKit passes what a form action returns to the page as `form`. For a
 * +page.svelte, read the sibling +page.server file and record, per returned
 * property, the taint of the value the actions return (including fail(status, {...})).
 */
function actionResults(file: ComponentFile | undefined): Map<string, Taint[]> {
  const out = new Map<string, Taint[]>();
  if (!file || !/(^|\/)\+page\.svelte$/.test(file.path)) return out;
  const dir = file.path.slice(0, file.path.lastIndexOf('/') + 1);
  for (const name of ['+page.server.ts', '+page.server.js']) {
    const text = file.read(`${dir}${name}`);
    if (!text) continue;
    const block = parseSource(text, name.endsWith('.ts') ? 'ts' : 'js').blocks[0];
    if (!block) continue;
    const tracker = new TaintTracker(new ImportMap(block.program), { serverActionsModule: false, routeFile: true });
    const record = (value: Node | null | undefined) => {
      const obj = unwrap(value);
      if (!obj) return;
      if (isCallNode(obj) && /(^|[.#])fail$/.test(memberPath(obj.callee as Node) ?? '')) {
        record(obj.arguments[1] as Node | undefined);
        return;
      }
      if (obj.type !== 'ObjectExpression') return;
      for (const p of obj.properties) {
        if (p.type !== 'ObjectProperty') continue;
        const key = keyName(p);
        if (key === null) continue;
        // Name the action file in the source: lines of that file mean nothing in the page.
        const taints = tracker.taintsOf(p.value as Node).map((t) => ({ ...t, source: `${t.source}, returned by the form action in ${name}`, line: 0 }));
        if (taints.length > 0) out.set(key, [...(out.get(key) ?? []), ...taints]);
      }
    };
    try {
      walkWithTaint(block.program, tracker, {
        enter(node, parents) {
          if (node.type !== 'ReturnStatement' || !node.argument) return;
          const inActions = parents.some((p) => p.type === 'VariableDeclarator' && p.id.type === 'Identifier' && p.id.name === 'actions');
          const fn = [...parents].reverse().find((p) => isFunctionNode(p));
          if (inActions && fn) record(node.argument as Node);
        },
      });
    } catch {
      // A file that does not parse contributes nothing.
    }
    break;
  }
  return out;
}

/** `form.html` or `form?.html` in a page: the action result property it reads. */
function formProperty(node: Node | null): string | null {
  let n = unwrap(node);
  while (n && isMemberNode(n) && isMemberNode(unwrap(n.object as Node))) n = unwrap(n.object as Node);
  if (!n || !isMemberNode(n)) return null;
  const root = unwrap(n.object as Node);
  return root?.type === 'Identifier' && root.name === 'form' ? propertyName(n) : null;
}

function scan(text: string, lang: ComponentLang, isSafeCall: (canonical: string) => boolean, file?: ComponentFile): HtmlDirective[] {
  if (!/v-html|innerHTML|\{@html|set:html/.test(text)) return [];
  const masked = maskScripts(maskComments(text, 'c+html'), lang);
  const found: Array<{ kind: HtmlDirective['kind']; start: number; end: number; expression: string; quoted: boolean }> = [];
  if (lang === 'vue') {
    const re = /(^|[\s<])(v-html|:innerHTML|v-bind:innerHTML)\s*=\s*(["'])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const quote = m[3] as string;
      const start = m.index + m[0].length;
      const end = masked.indexOf(quote, start);
      if (end === -1) continue;
      found.push({ kind: m[2] === 'v-html' ? 'v-html' : ':innerHTML', start, end, expression: text.slice(start, end), quoted: false });
    }
  } else if (lang === 'svelte') {
    const re = /\{@html\s/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const start = m.index + m[0].length;
      const end = matchBrace(masked, m.index);
      if (end === -1) continue;
      found.push({ kind: '{@html}', start, end, expression: text.slice(start, end), quoted: false });
    }
  } else {
    const re = /\bset:html\s*=\s*([{"'])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const open = m.index + m[0].length - 1;
      if (m[1] === '{') {
        const end = matchBrace(masked, open);
        if (end === -1) continue;
        found.push({ kind: 'set:html', start: open + 1, end, expression: text.slice(open + 1, end), quoted: false });
      } else {
        const end = masked.indexOf(m[1] as string, open + 1);
        if (end === -1) continue;
        found.push({ kind: 'set:html', start: open, end: end + 1, expression: text.slice(open, end + 1), quoted: true });
      }
    }
  }
  if (found.length === 0) return [];
  const analyzed = analyze(text, lang);
  const actions = lang === 'svelte' ? actionResults(file) : new Map<string, Taint[]>();
  const starts = lineStarts(text);
  return found.map((f) => {
    const pos = offsetToPosition(starts, f.start);
    const endPos = offsetToPosition(starts, f.end);
    let node: Node | null = null;
    try {
      node = parseExpression(f.expression, { plugins: ['typescript'], startLine: pos.line, startColumn: pos.column - 1 }) as Node;
    } catch {
      node = null;
    }
    const taints: Taint[] = [];
    let constant = f.quoted;
    let safe = false;
    if (node) {
      for (const p of analyzed.programs) {
        taints.push(...p.tracker.taintsOf(node));
        if (!constant && constantIn(node, p.program)) constant = true;
        if (!safe && safeIn(node, p.imports, p.program, isSafeCall, 0)) safe = true;
      }
      if (!constant && isConstantExpression(node)) constant = true;
      if (!safe && analyzed.programs.length === 0) safe = safeIn(node, null, null, isSafeCall, 0);
      const prop = formProperty(node);
      if (prop !== null) taints.push(...(actions.get(prop) ?? []).map((t) => ({ ...t, line: pos.line })));
    }
    return {
      kind: f.kind,
      line: pos.line,
      column: pos.column,
      endColumn: endPos.line === pos.line ? endPos.column : pos.column + 1,
      expression: f.expression.trim(),
      node,
      constant,
      safe,
      taints,
    };
  });
}

function analyze(text: string, lang: ComponentLang): Analyzed {
  const out: Analyzed = { programs: [] };
  const parsed = parseSource(text, lang);
  for (const block of parsed.blocks) {
    const imports = new ImportMap(block.program);
    const tracker = new TaintTracker(imports, { serverActionsModule: false, routeFile: false });
    try {
      walkWithTaint(block.program, tracker);
    } catch {
      continue;
    }
    out.programs.push({ tracker, imports, program: block.program });
  }
  return out;
}

function constantIn(node: Node, program: import('@babel/types').File): boolean {
  const n = unwrap(node);
  if (!n) return true;
  if (n.type === 'Identifier') {
    const init = topLevelConst(program, n.name);
    return init !== null && isConstantExpression(init);
  }
  return false;
}

function safeIn(node: Node, imports: ImportMap | null, program: import('@babel/types').File | null, isSafeCall: (c: string) => boolean, depth: number): boolean {
  const n = unwrap(node);
  if (!n || depth > 3) return false;
  if (isCallNode(n)) {
    const canonical = imports ? imports.canonical(n.callee as Node) : null;
    return isSafeCall(canonical ?? '');
  }
  if (isMemberNode(n)) return safeIn(n.object as Node, imports, program, isSafeCall, depth + 1);
  if (n.type === 'Identifier' && program) {
    const init = topLevelConst(program, n.name);
    return init !== null && safeIn(init, imports, program, isSafeCall, depth + 1);
  }
  return false;
}

/** Offset of the `}` matching the `{` at `open`, skipping strings; -1 when unbalanced. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const close = text.indexOf(ch, i + 1);
      if (close === -1) return -1;
      i = close;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Blank out script and style blocks and Astro frontmatter, keeping offsets and line breaks. */
function maskScripts(text: string, lang: ComponentLang): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = text.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_m, open: string, _tag: string, body: string, close: string) => open + blank(body) + close);
  if (lang === 'astro') out = out.replace(/^(\s*---\r?\n)([\s\S]*?)(\r?\n---)/, (_m, a: string, body: string, b: string) => a + blank(body) + b);
  return out;
}
