import type { Lang } from '../core/files.ts';

/**
 * Find comments without a full parser. Used for suppressions (which must be
 * real comments, not strings or docs) and for text rules that should ignore
 * commented-out code. The C-style scanner tracks strings, template literals
 * (with nested ${}), and regular expression literals well enough for these
 * uses; JSX text containing "//" can be misread, which only affects
 * comment-based features on that line.
 */

export type CommentStyle = 'c' | 'hash' | 'sql' | 'html' | 'c+html' | 'none';

export interface CommentSpan {
  /** Offset of the comment opener. */
  start: number;
  /** Offset after the comment closer (or the end of the line). */
  end: number;
  /** 1-based line of the opener. */
  line: number;
  /** Comment text without the opener and closer. */
  body: string;
}

export function commentStyleFor(lang: Lang, path = ''): CommentStyle {
  switch (lang) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'json':
    case 'firebase-rules':
      return 'c';
    case 'vue':
    case 'svelte':
    case 'astro':
      return 'c+html';
    case 'yaml':
    case 'toml':
    case 'shell':
    case 'env':
      return 'hash';
    case 'sql':
      return 'sql';
    case 'markdown':
      return 'html';
    default:
      if (/(^|\/)(Dockerfile|Makefile|Procfile|\.gitignore|\.npmrc|\.yarnrc|\.pypirc|[^/]*\.(py|rb|ini|cfg|conf|properties|tf|hcl))$/.test(path)) return 'hash';
      return 'none';
  }
}

export function findComments(text: string, style: CommentStyle): CommentSpan[] {
  let spans: CommentSpan[];
  switch (style) {
    case 'c':
      spans = scanC(text, 0);
      break;
    case 'c+html':
      spans = scanComponent(text);
      break;
    case 'hash':
      spans = scanHash(text);
      break;
    case 'sql':
      spans = scanSql(text);
      break;
    case 'html': {
      // Markdown: `<!--` inside a code block or code span is shown as text, so it is not a comment.
      const code = markdownCode(text);
      spans = scanHtml(text, 0, text.length).filter((s) => !code.some(([from, to]) => s.start >= from && s.start < to));
      break;
    }
    default:
      spans = [];
  }
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  for (const span of spans) span.line = lineOfOffset(starts, span.start);
  return spans;
}

function lineOfOffset(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Vue, Svelte, and Astro: JavaScript comments inside script blocks (and Astro frontmatter), HTML comments elsewhere. */
function scanComponent(text: string): CommentSpan[] {
  const blocks: Array<[number, number]> = [];
  const fm = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fm && fm[1] !== undefined) {
    const start = (fm.index ?? 0) + fm[0].indexOf(fm[1]);
    blocks.push([start, start + fm[1].length]);
  }
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
    blocks.push([start, start + (m[1] ?? '').length]);
  }
  const out: CommentSpan[] = [];
  let cursor = 0;
  for (const [start, end] of blocks.sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    out.push(...scanHtml(text, cursor, start));
    out.push(...scanC(text.slice(start, end), start));
    cursor = end;
  }
  out.push(...scanHtml(text, cursor, text.length));
  return out.sort((a, b) => a.start - b.start);
}

/** Replace comment characters with spaces (newlines kept), so offsets and lines stay the same. */
export function maskComments(text: string, style: CommentStyle): string {
  const spans = findComments(text, style);
  if (spans.length === 0) return text;
  let out = '';
  let last = 0;
  for (const s of spans) {
    if (s.start < last) continue;
    out += text.slice(last, s.start);
    out += text.slice(s.start, s.end).replace(/[^\n]/g, ' ');
    last = s.end;
  }
  return out + text.slice(last);
}

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function scanC(text: string, base: number): CommentSpan[] {
  const out: CommentSpan[] = [];
  const n = text.length;
  let i = 0;
  // Brace depths at which a template literal's ${...} closes.
  const templateStack: number[] = [];
  let braceDepth = 0;
  // Last significant token class, to tell a regex literal from division.
  let last = '';
  while (i < n) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push({ start: base + i, end: base + stop, line: 0, body: text.slice(i + 2, stop) });
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push({ start: base + i, end: base + stop, line: 0, body: text.slice(i + 2, end === -1 ? n : end) });
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(text, i, ch);
      last = 'a';
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(text, i + 1, templateStack, braceDepth);
      last = 'a';
      continue;
    }
    if (ch === '/') {
      if (last === '' || REGEX_PRECEDERS.has(last)) {
        const end = skipRegex(text, i);
        if (end > i) {
          i = end;
          last = 'a';
          continue;
        }
      }
      last = '/';
      i++;
      continue;
    }
    if (ch === '{') braceDepth++;
    else if (ch === '}') {
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        braceDepth--;
        i = skipTemplate(text, i + 1, templateStack, braceDepth);
        last = 'a';
        continue;
      }
      braceDepth--;
    }
    if (/[\w$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(text[j] as string)) j++;
      last = REGEX_KEYWORDS.has(text.slice(i, j)) ? '(' : 'a';
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) last = ch;
    i++;
  }
  return out;
}

function skipString(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote || ch === '\n') return i + 1;
    i++;
  }
  return i;
}

/**
 * Skip template text from `start` (after the backtick, or after the `}` that
 * closes a substitution) to the closing backtick, or to the `{` of the next
 * `${`, which the caller then counts as an open brace.
 */
function skipTemplate(text: string, start: number, stack: number[], depth: number): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') return i + 1;
    if (ch === '$' && text[i + 1] === '{') {
      stack.push(depth + 1);
      return i + 1;
    }
    i++;
  }
  return i;
}

function skipRegex(text: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') return start; // not a regex
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < text.length && /[a-z]/i.test(text[i] as string)) i++;
      return i;
    }
    i++;
  }
  return start;
}

function scanHash(text: string): CommentSpan[] {
  const out: CommentSpan[] = [];
  let offset = 0;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === '\\' && quote === '"') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] as string))) {
        out.push({ start: offset + i, end: offset + line.length, line: index + 1, body: line.slice(i + 1).replace(/\r$/, '') });
        break;
      }
    }
    offset += line.length + 1;
  });
  return out;
}

function scanSql(text: string): CommentSpan[] {
  const out: CommentSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      i = skipString(text, i, "'");
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out.push({ start: i, end: stop, line: 0, body: text.slice(i + 2, stop) });
      i = stop;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out.push({ start: i, end: stop, line: 0, body: text.slice(i + 2, end === -1 ? text.length : end) });
      i = stop;
      continue;
    }
    if (ch === '$' && /^\$[A-Za-z_]*\$/.test(text.slice(i, i + 40))) {
      // Dollar-quoted body ($$ ... $$ or $tag$ ... $tag$): skip it.
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 40))?.[0] as string;
      const end = text.indexOf(tag, i + tag.length);
      i = end === -1 ? text.length : end + tag.length;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Offsets of Markdown code: fenced blocks (``` or ~~~, closed by a fence of
 * the same character at least as long) and code spans on one line (a run of
 * backticks up to the next run of the same length). An unclosed fence runs to
 * the end of the file; an unmatched backtick is text.
 */
export function markdownCode(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let fence: { char: string; length: number; start: number } | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    const end = offset + line.length;
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (opener && (opener[1] as string)[0] === fence.char && (opener[1] as string).length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) {
        out.push([fence.start, end]);
        fence = null;
      }
    } else if (opener) {
      fence = { char: (opener[1] as string)[0] as string, length: (opener[1] as string).length, start: offset };
    } else {
      const ticks = /`+/g;
      let open: RegExpExecArray | null;
      while ((open = ticks.exec(line))) {
        const run = open[0];
        const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
        close.lastIndex = open.index + run.length;
        const match = close.exec(line);
        if (!match) continue;
        out.push([offset + open.index, offset + match.index + run.length]);
        ticks.lastIndex = match.index + run.length;
      }
    }
    offset = end + 1;
  }
  if (fence) out.push([fence.start, text.length]);
  return out;
}

function scanHtml(text: string, from: number, to: number): CommentSpan[] {
  const out: CommentSpan[] = [];
  let i = text.indexOf('<!--', from);
  while (i !== -1 && i < to) {
    const end = text.indexOf('-->', i + 4);
    const stop = end === -1 ? text.length : end + 3;
    out.push({ start: i, end: stop, line: 0, body: text.slice(i + 4, end === -1 ? text.length : end) });
    i = text.indexOf('<!--', stop);
  }
  return out;
}
