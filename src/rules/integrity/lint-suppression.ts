import { splitLines } from '../../core/diff.ts';
import { findComments } from '../../lang/comments.ts';
import type { Rule } from '../types.ts';
import { type Occurrence, changesOf, commentStyleForPath, isTestFile, newOccurrences, normalizeWhitespace, prepareRun, snippet, sourceKind } from './shared.ts';

/**
 * Lint suppressions added in the change. File-wide suppressions without rule
 * names (`/* eslint-disable *\/`, `// biome-ignore-all lint`, `// oxlint-disable`,
 * `# ruff: noqa`, `# flake8: noqa`, `# pylint: skip-file`) block; targeted and
 * line-level ones warn. A suppression that already existed at the base, or
 * only moved, is not reported. Generated files are ignored, and in test
 * files only file-wide suppressions are reported.
 */

type Scope = 'file' | 'range' | 'line';

interface Directive extends Occurrence {
  column: number;
  tool: string;
  scope: Scope;
  /** Rules named; empty means every rule. */
  rules: string[];
  /** The directive as written, for messages. */
  shown: string;
  /** ESLint ignores `// eslint-disable` in a line comment; other linters may not. */
  lineCommentFileDisable?: boolean;
}

const ESLINT = /^(eslint|oxlint)-(disable|enable)(-next-line|-line)?(?=\s|$)([\s\S]*)$/;
const BIOME = /^biome-ignore(-all|-start|-end)?(?=\s|:|$)\s*([^:]*?)\s*(?::[\s\S]*)?$/;

function rulesOf(text: string): string[] {
  const withoutReason = text.split(/\s--(?:\s|$)/)[0] ?? '';
  return withoutReason
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !/^\/\//.test(r));
}

function jsDirectives(text: string, path: string, lang: Parameters<typeof commentStyleForPath>[0]): Directive[] {
  const out: Directive[] = [];
  const style = commentStyleForPath(lang, path);
  if (style === 'none' || style === 'hash' || style === 'sql') return out;
  const spans = findComments(text, style);
  const enables: Array<{ line: number; tool: string; rules: string[] }> = [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  for (const span of spans) {
    const opener = text.slice(span.start, span.start + 4);
    const kind = opener.startsWith('//') ? 'line' : opener.startsWith('<!--') ? 'html' : 'block';
    const body = span.body.replace(/^[\s*]+/, '').replace(/\s+$/, '');
    const column = span.start - (starts[span.line - 1] ?? 0) + 1;
    const m = ESLINT.exec(body);
    if (m) {
      const tool = m[1] as string;
      const rules = rulesOf(m[4] ?? '');
      if (m[2] === 'enable') {
        enables.push({ line: span.line, tool, rules });
        continue;
      }
      const suffix = m[3] ?? '';
      const shown = kind === 'line' ? `// ${tool}-disable${suffix}${rules.length ? ` ${rules.join(', ')}` : ''}` : kind === 'html' ? `<!-- ${tool}-disable${suffix}${rules.length ? ` ${rules.join(', ')}` : ''} -->` : `/* ${tool}-disable${suffix}${rules.length ? ` ${rules.join(', ')}` : ''} */`;
      out.push({
        line: span.line,
        column,
        tool: tool === 'eslint' ? 'ESLint' : 'oxlint',
        scope: suffix ? 'line' : 'file',
        rules,
        shown,
        sig: `${tool}|${suffix || 'file'}|${rules.join(',')}`,
        ...(tool === 'eslint' && !suffix && kind === 'line' ? { lineCommentFileDisable: true } : {}),
      });
      continue;
    }
    const b = BIOME.exec(body);
    if (b) {
      const variant = b[1] ?? '';
      if (variant === '-end') continue;
      const categories = (b[2] ?? '').split(/\s+/).filter(Boolean);
      const lint = categories.filter((c) => c === 'lint' || c.startsWith('lint/'));
      if (lint.length === 0) continue; // format, assist, syntax: not a lint check
      const all = lint.includes('lint');
      out.push({
        line: span.line,
        column,
        tool: 'Biome',
        scope: variant === '-all' ? 'file' : variant === '-start' ? 'range' : 'line',
        rules: all ? [] : lint,
        shown: `// biome-ignore${variant} ${lint.join(' ')}`,
        sig: `biome|${variant || 'line'}|${lint.join(' ')}`,
      });
    }
  }
  // A disable followed by a matching enable covers a range, not the rest of the file.
  for (const d of out) {
    if (d.scope !== 'file' || d.tool === 'Biome') continue;
    const tool = d.tool === 'ESLint' ? 'eslint' : 'oxlint';
    // An enable without rules closes any disable; an enable with rules only closes a disable of those rules.
    const closed = enables.some((e) => e.line > d.line && e.tool === tool && (e.rules.length === 0 || (d.rules.length > 0 && d.rules.every((r) => e.rules.includes(r)))));
    if (closed) d.scope = 'range';
  }
  return out;
}

function pythonDirectives(text: string): Directive[] {
  const out: Directive[] = [];
  const lines = splitLines(text);
  for (const span of findComments(text, 'hash')) {
    const body = span.body.trim();
    const lineText = lines[span.line - 1] ?? '';
    const ownLine = lineText.trimStart().startsWith('#');
    const topLevel = ownLine && !/^\s/.test(lineText);
    const column = lineText.indexOf('#') + 1;
    const add = (tool: string, scope: Scope, rules: string[], shown: string) => out.push({ line: span.line, column, tool, scope, rules, shown, sig: `${tool}|${scope}|${normalizeWhitespace(body)}` });
    let m: RegExpExecArray | null;
    if ((m = /^ruff\s*:\s*noqa\b\s*(?::\s*(.*))?$/i.exec(body))) {
      const rules = (m[1] ?? '').split(/[\s,]+/).filter(Boolean);
      add('Ruff', 'file', rules, `# ruff: noqa${rules.length ? `: ${rules.join(', ')}` : ''}`);
    } else if (/^flake8\s*[:=]\s*noqa\b/i.test(body)) {
      add('flake8', 'file', [], '# flake8: noqa');
    } else if (/^pylint\s*:\s*skip-file\b/i.test(body)) {
      add('pylint', 'file', [], '# pylint: skip-file');
    } else if ((m = /^pylint\s*:\s*disable\s*=\s*([\w\s,-]+)/i.exec(body))) {
      const rules = (m[1] ?? '').split(/[\s,]+/).filter(Boolean);
      const all = rules.includes('all');
      add('pylint', topLevel ? 'file' : ownLine ? 'range' : 'line', all ? [] : rules, `# pylint: disable=${rules.join(',')}`);
    } else if ((m = /^noqa\b\s*(?::\s*(.*))?$/i.exec(body))) {
      const rules = (m[1] ?? '').split(/[\s,]+/).filter(Boolean);
      add('flake8/Ruff', 'line', rules, `# noqa${rules.length ? `: ${rules.join(', ')}` : ''}`);
    }
  }
  return out;
}

function goDirectives(text: string): Directive[] {
  const out: Directive[] = [];
  const lines = splitLines(text);
  for (const span of findComments(text, 'c')) {
    const m = /^\s?nolint\b(?::([\w,-]+))?/.exec(span.body);
    if (!m) continue;
    const rules = (m[1] ?? '').split(',').filter(Boolean);
    const lineText = lines[span.line - 1] ?? '';
    out.push({ line: span.line, column: Math.max(1, lineText.indexOf('//') + 1), tool: 'golangci-lint', scope: 'line', rules, shown: `//nolint${rules.length ? `:${rules.join(',')}` : ''}`, sig: `nolint|${rules.join(',')}` });
  }
  return out;
}

function directives(text: string, path: string, lang: Parameters<typeof commentStyleForPath>[0]): Directive[] {
  switch (sourceKind(path)) {
    case 'python':
      return pythonDirectives(text);
    case 'go':
      return goDirectives(text);
    default:
      return lang === 'js' || lang === 'jsx' || lang === 'ts' || lang === 'tsx' || lang === 'vue' || lang === 'svelte' || lang === 'astro' ? jsDirectives(text, path, lang) : [];
  }
}

function describe(d: Directive): { message: string; block: boolean } {
  const named = d.rules.length > 0 ? snippet(d.rules.join(', '), 60) : null;
  const shown = `\`${snippet(d.shown, 80)}\``;
  if (d.scope === 'file') {
    // ESLint and oxlint disables run to the end of the file; the others cover the whole file.
    const extent = d.tool === 'ESLint' || d.tool === 'oxlint' || d.tool === 'pylint' ? 'the rest of this file' : 'this whole file';
    if (named) return { message: `${shown} turns off ${named} for ${extent}.`, block: false };
    if (d.lineCommentFileDisable) return { message: `${shown} asks linters to skip every rule for the rest of this file (ESLint itself only reads this form in a block comment).`, block: false };
    if (/skip-file|flake8: noqa/.test(d.shown)) return { message: `${shown} makes ${d.tool} skip this whole file.`, block: true };
    return { message: `${shown} turns off every ${d.tool}${d.tool === 'Biome' ? ' lint' : ''} rule for ${extent}.`, block: true };
  }
  if (d.scope === 'range') return { message: `${shown} turns off ${named ?? `every ${d.tool} rule`} for a block of code.`, block: false };
  const where = /next-line/.test(d.shown) || (d.tool === 'Biome' && d.scope === 'line') ? 'the next line' : 'this line';
  return { message: `${shown} turns off ${named ?? 'every lint rule'} for ${where}.`, block: false };
}

const QUICK = /eslint-disable|oxlint-disable|biome-ignore|noqa|pylint\s*:|nolint/i;

export const lintSuppression: Rule = {
  meta: {
    id: 'integrity/lint-suppression',
    level: 'block',
    scope: 'diff',
    title: 'Lint rules turned off in the change',
    summary: 'New lint suppressions: file-wide ones without rule names (`/* eslint-disable */`, `// biome-ignore-all lint`, `// oxlint-disable`, `# ruff: noqa`, `# flake8: noqa`, `# pylint: skip-file`) and line-level disables.',
    why: 'Turning a linter off for a whole file hides every current and future problem in it, and agents do it to get a green run. Line-level disables are sometimes right, so they are listed for review rather than blocked.',
    fix: 'Remove the suppression and fix what the linter reports.',
    levels: 'block for file-wide suppressions that name no rule; warn for suppressions that name rules, cover a range, or cover one line. In test files only the blocking kind is reported.',
  },
  appliesTo: (file) => !file.generated && !/\.min\.[cm]?js$/.test(file.path),
  project: prepareRun,
  diff(ctx) {
    if (ctx.after === null) return;
    const changes = changesOf(ctx);
    if (!changes.added.some((l) => QUICK.test(l.text))) return;
    const after = directives(ctx.after, ctx.file.path, ctx.file.lang);
    if (after.length === 0) return;
    const before = changes.before === null ? [] : directives(changes.before, ctx.file.path, ctx.file.lang);
    const testFile = isTestFile(ctx.file.path) || ctx.file.contexts.has('test');
    for (const d of newOccurrences(after, before, changes.addedLines)) {
      const { message, block } = describe(d);
      if (testFile && !block) continue;
      ctx.report({
        line: d.line,
        column: d.column,
        level: block ? 'block' : 'warn',
        message,
        fix: block
          ? 'Remove the suppression and fix what the linter reports, or turn off only the specific rule on the lines that need it and say why.'
          : 'Fix the lint error, or keep the suppression with a comment that says why the rule does not apply here.',
        key: d.sig,
      });
    }
  },
};
