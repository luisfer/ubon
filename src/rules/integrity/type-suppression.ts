import type { Node } from '@babel/types';
import type { Lang } from '../../core/files.ts';
import { parseSource } from '../../lang/parse.ts';
import { isNode } from '../../lang/walk.ts';
import type { Rule } from '../types.ts';
import { baseName, changesOf, isTestFile, prepareRun, snippet } from './shared.ts';

/**
 * TypeScript escapes added in the change: `@ts-nocheck`, `@ts-ignore`,
 * `@ts-expect-error` without a reason, `as any`, `as unknown as T`, and
 * `: any` annotations. A kind is only reported in a file that had none of
 * that kind at the base: a file that already uses `as any` is not flagged for
 * one more. Declaration files and generated code are ignored.
 *
 * Test files often cast mocks and pass invalid input on purpose, so only
 * `@ts-nocheck` is reported there.
 */

type Kind = 'ts-nocheck' | 'ts-ignore' | 'ts-expect-error' | 'as-any' | 'as-unknown-as' | 'any-annotation';

interface Escape {
  kind: Kind;
  line: number;
  column: number;
  message: string;
  fix: string;
}

const SCRIPT = new Set<Lang>(['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro']);
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens', 'errors', 'range']);

function visitAll(node: Node, parents: Node[], fn: (node: Node, parents: readonly Node[]) => void): void {
  if (parents.length > 1500) return;
  fn(node, parents);
  parents.push(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visitAll(item, parents, fn);
    } else if (isNode(value)) {
      visitAll(value, parents, fn);
    }
  }
  parents.pop();
}

function stripParens(node: Node): Node {
  let n = node;
  while (n.type === 'ParenthesizedExpression') n = n.expression as Node;
  return n;
}

function typeText(node: Node, text: string): string {
  return node.start != null && node.end != null ? snippet(text.slice(node.start, node.end), 40) : 'T';
}

/** What an `any` annotation is attached to, for the message. */
function annotatedName(parents: readonly Node[], text: string): string | null {
  const owner = parents[parents.length - 1];
  if (!owner) return null;
  switch (owner.type) {
    case 'Identifier':
      return owner.name;
    case 'ObjectPattern':
    case 'ArrayPattern':
      return typeText(owner, text).replace(/\s*:\s*any$/, '');
    case 'RestElement':
      return owner.argument.type === 'Identifier' ? `...${owner.argument.name}` : null;
    case 'ClassProperty':
    case 'ClassAccessorProperty':
    case 'TSPropertySignature':
      return owner.key.type === 'Identifier' ? owner.key.name : owner.key.type === 'StringLiteral' ? owner.key.value : null;
    case 'TSIndexSignature': {
      const param = owner.parameters[0];
      const keyType = (param?.typeAnnotation as { typeAnnotation?: Node } | null | undefined)?.typeAnnotation;
      return param ? `[${param.name}: ${keyType ? typeText(keyType, text) : 'string'}]` : null;
    }
    default:
      return null;
  }
}

function isReturnType(parents: readonly Node[], node: Node): boolean {
  const owner = parents[parents.length - 1] as { returnType?: unknown } | undefined;
  return !!owner && owner.returnType === node;
}

/** Every escape in a file, or null when it cannot be parsed. */
function findEscapes(text: string, lang: Lang, testFile: boolean): Escape[] | null {
  const parsed = parseSource(text, lang);
  if (parsed.blocks.length === 0 && (parsed.failed || lang === 'js' || lang === 'jsx' || lang === 'ts' || lang === 'tsx')) return null;
  const out: Escape[] = [];
  for (const block of parsed.blocks) {
    const comments = ((block.program as unknown as { comments?: Array<{ type: string; value: string; loc?: { start: { line: number; column: number } } }> }).comments ?? []);
    for (const c of comments) {
      const line = c.loc?.start.line ?? 1;
      const column = (c.loc?.start.column ?? 0) + 1;
      const value = c.type === 'CommentBlock' ? (c.value.split('\n').pop() ?? '') : c.value;
      const head = c.type === 'CommentBlock' ? c.value : value;
      if (/^[\s*/]*@ts-nocheck\b/.test(head)) {
        out.push({ kind: 'ts-nocheck', line, column, message: '`@ts-nocheck` turns off type checking for the whole file.', fix: 'Remove `@ts-nocheck` and fix the type errors it hides.' });
        continue;
      }
      if (testFile) continue;
      if (/^[\s*/]*@ts-ignore\b/.test(value)) {
        out.push({ kind: 'ts-ignore', line, column, message: '`@ts-ignore` hides the type error on the next line.', fix: 'Fix the type error; if the error is expected, use `@ts-expect-error` with a short reason.' });
        continue;
      }
      const expect = /^[\s*/]*@ts-expect-error\b(.*)$/.exec(value);
      if (expect) {
        const reason = (expect[1] ?? '').replace(/\*\/\s*$/, '').replace(/^[\s:\-]+/, '').trim();
        if (!/[A-Za-z]{2,}/.test(reason)) {
          out.push({ kind: 'ts-expect-error', line, column, message: '`@ts-expect-error` has no reason, so a reader cannot tell which error it expects.', fix: 'Add a short reason after `@ts-expect-error`, or fix the type error.' });
        }
      }
    }
    if (testFile) continue;
    visitAll(block.program.program, [], (node, parents) => {
      const line = node.loc?.start.line ?? 1;
      const column = (node.loc?.start.column ?? 0) + 1;
      if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
        const annotation = node.typeAnnotation as Node;
        if (annotation.type === 'TSAnyKeyword') {
          const expr = typeText(stripParens(node.expression as Node), text);
          out.push({ kind: 'as-any', line, column, message: `\`${expr} as any\` turns off type checking for this value.`, fix: 'Use the real type, or `unknown` with a type guard.' });
          return;
        }
        const inner = stripParens(node.expression as Node);
        if ((inner.type === 'TSAsExpression' || inner.type === 'TSTypeAssertion') && (inner.typeAnnotation as Node).type === 'TSUnknownKeyword') {
          const target = typeText(annotation, text);
          out.push({
            kind: 'as-unknown-as',
            line,
            column,
            message: `\`as unknown as ${target}\` forces the type ${target} without checking it.`,
            fix: `Fix the types so the value is a ${target} without a double cast, or check it at runtime.`,
          });
        }
        return;
      }
      if (node.type === 'TSTypeAnnotation' && (node.typeAnnotation as Node).type === 'TSAnyKeyword') {
        const owner = parents[parents.length - 1];
        const grand = parents[parents.length - 2];
        if (grand?.type === 'CatchClause' && (grand as { param?: unknown }).param === owner) return; // catch (e: any) is the default
        // `(ev: Event) => any` in a callback type: the return value is ignored, as in the DOM typings.
        if ((owner?.type === 'TSFunctionType' || owner?.type === 'TSConstructorType') && (owner as { typeAnnotation?: unknown }).typeAnnotation === node) return;
        const anyNode = node.typeAnnotation as Node;
        const where = { line: anyNode.loc?.start.line ?? line, column: (anyNode.loc?.start.column ?? 0) + 1 };
        if (isReturnType(parents, node)) {
          out.push({ kind: 'any-annotation', ...where, message: 'The return type `any` turns off type checking for what this function returns.', fix: 'Declare the real return type, or `unknown` and narrow it where it is used.' });
          return;
        }
        const name = annotatedName(parents, text);
        if (name?.startsWith('[')) {
          out.push({
            kind: 'any-annotation',
            ...where,
            message: `The index signature \`${name}: any\` turns off type checking for every property it covers.`,
            fix: 'Declare the properties you use, or use `unknown` for the index signature.',
          });
          return;
        }
        out.push({
          kind: 'any-annotation',
          ...where,
          message: name ? `\`${name}: any\` turns off type checking for ${name}.` : 'This `: any` annotation turns off type checking for the value.',
          fix: name ? `Give ${name} a real type, or use \`unknown\` and narrow it.` : 'Use a real type, or `unknown` and narrow it.',
        });
      }
    });
  }
  return out;
}

const QUICK = /@ts-(nocheck|ignore|expect-error)|\bany\b/;

export const typeSuppression: Rule = {
  meta: {
    id: 'integrity/type-suppression',
    level: 'block',
    scope: 'diff',
    title: 'Type checking turned off in the change',
    summary: 'New `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error` without a reason, `as any`, `as unknown as T`, or `: any` in a file that had none of that kind before.',
    why: 'Agents silence type errors instead of fixing them, and each escape hides the next real bug in that code. `@ts-nocheck` turns off checking for the whole file.',
    fix: 'Fix the type error instead of silencing it.',
    cwe: ['CWE-704'],
    levels: 'block for `@ts-nocheck`; warn for `@ts-ignore`, `@ts-expect-error` without a reason, `as any`, `as unknown as T`, and `: any`. In test files only `@ts-nocheck` is reported.',
  },
  appliesTo: (file) => SCRIPT.has(file.lang) && !file.generated && !/\.d\.[cm]?ts$/.test(file.path),
  project: prepareRun,
  diff(ctx) {
    if (ctx.after === null) return;
    const changes = changesOf(ctx);
    if (!changes.added.some((l) => QUICK.test(l.text))) return;
    const testFile = isTestFile(ctx.file.path) || ctx.file.contexts.has('test');
    const after = findEscapes(ctx.after, ctx.file.lang, testFile);
    if (!after || after.length === 0) return;
    const before = changes.before === null ? [] : findEscapes(changes.before, ctx.file.lang, testFile);
    if (before === null) return;
    const hadKind = new Set(before.map((e) => e.kind));
    const seen = new Set<string>();
    for (const e of after) {
      if (hadKind.has(e.kind) || !changes.addedLines.has(e.line)) continue;
      const key = `${e.kind}:${e.line}:${e.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.report({
        line: e.line,
        column: e.column,
        level: e.kind === 'ts-nocheck' ? 'block' : 'warn',
        message: e.kind === 'ts-nocheck' ? `\`@ts-nocheck\` turns off type checking for all of ${baseName(ctx.file.path)}.` : e.message,
        fix: e.fix,
        key: e.kind,
      });
    }
  },
};
