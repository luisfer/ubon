import { splitLines } from '../../core/diff.ts';
import { findComments } from '../../lang/comments.ts';
import { changesOf, commentStyleForPath, isFixtureData, isTestFile, maskCode, maskFamily, newOccurrences, normalizeWhitespace, prepareRun, snippet, sourceKind, type Occurrence } from '../integrity/shared.ts';
import type { FileInfo, Rule } from '../types.ts';

/**
 * Placeholders left in runtime code: `throw new Error('Not implemented')`
 * and its equivalents, `TODO: implement`, lorem ipsum, `your-api-key-here`
 * values, and example.com endpoints. Plain TODO comments are fine. Test
 * files, fixtures, stories, seeds, docs, and examples are not checked.
 */

interface Hit extends Occurrence {
  column: number;
  message: string;
  fix: string;
}

const NOT_IMPLEMENTED = /^\s*(?:todo\b.*|fixme\b.*|not\s+(?:yet\s+)?implemented\b.*|(?:method|function|feature|endpoint|handler)\s+(?:is\s+)?not\s+(?:yet\s+)?implemented\.?|unimplemented\.?|implement\s+(?:me|this)\b.*)\s*$/i;
const TODO_IMPLEMENT =
  /^\s*(?:TODO|FIXME|XXX)\b\s*(?:\([^)]*\))?\s*[:\-]?\s*(?:implement(?:ation)?(?:\s+(?:this|me|it|here|this\s+(?:function|method)|the\s+(?:actual\s+|real\s+)?(?:logic|implementation|function|method|handler|endpoint|body)))?|(?:add|write)\s+(?:the\s+)?(?:actual|real)\s+(?:implementation|logic|code)|replace\s+(?:this\s+)?with\s+(?:the\s+|a\s+)?(?:actual|real)\s+(?:implementation|logic|code|api\s+call|data))\s*[.!]?\s*$/i;
const YOUR_CODE_HERE = /^\s*(?:(?:add|put|write|insert)\s+)?your\s+(?:code|logic|implementation)\s+(?:goes\s+)?here\.?\s*$/i;
/**
 * your-api-key-here, YOUR_API_KEY, <your api key>, insert-your-token-here,
 * changeme. Words separated by spaces ("Your API key") are UI text, not
 * placeholder values, unless they sit in angle brackets.
 */
const KEY_PLACEHOLDER =
  /^<\s*(?:your|my)[-_ ][\w -]{0,40}?(?:api[-_ ]?key|key|token|secret|password|id|url|endpoint|domain)[\w -]{0,10}>$|^(?:your|my)[-_](?:[a-z0-9]+[-_]){0,3}?(?:api[-_]?key|key|token|secret|password|passwd|client[-_]?id|client[-_]?secret|project[-_]?(?:id|ref)|app[-_]?id|access[-_]?key|account[-_]?id|org(?:anization)?[-_]?id|webhook[-_]?secret|dsn|endpoint|domain|url|username)(?:[-_]here)?$|^(?:insert|enter|put|paste|add|replace)[-_](?:your|the)[-_][\w-]+?[-_]here$|^(?:replace[-_]?me|change[-_]?me|YOUR_[A-Z0-9_]+_HERE|REPLACE_WITH_[A-Z0-9_]+)$/i;
const EXAMPLE_URL = /\bhttps?:\/\/(?:[\w-]+\.)*example\.(?:com|org|net)\b[^\s'"`]*/i;
const NOT_RUNTIME = /(^|\/)(seeds?|seeders?|mocks?|stubs?|stories|storybook|\.storybook|placeholders?|demos?|samples?|sandbox|playground|scripts?\/dev|e2e)(\/|\.|$)|\.(stories|story|mock|stub|seed|sample)\.[\w]+$/i;
const CODE = new Set(['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'astro']);

function isRuntimeCode(file: FileInfo): boolean {
  if (file.generated || isFixtureData(file.path) || isTestFile(file.path) || NOT_RUNTIME.test(file.path)) return false;
  if (file.contexts.has('test') || file.contexts.has('docs') || file.contexts.has('example')) return false;
  return CODE.has(file.lang) || sourceKind(file.path) !== 'other';
}

/**
 * String literal contents on a line whose comments are already masked,
 * including strings nested in template literal expressions
 * (`${process.env.KEY ?? 'your-key-here'}`).
 */
function stringsIn(line: string, base = 0, depth = 0): Array<{ value: string; index: number }> {
  const out: Array<{ value: string; index: number }> = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      out.push({ value: line.slice(i + 1, j), index: base + i });
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      let text = '';
      let j = i + 1;
      while (j < line.length && line[j] !== '`') {
        if (line[j] === '\\') {
          text += line.slice(j, j + 2);
          j += 2;
        } else if (line[j] === '$' && line[j + 1] === '{') {
          let braces = 1;
          let k = j + 2;
          while (k < line.length && braces > 0) {
            if (line[k] === '{') braces++;
            else if (line[k] === '}') braces--;
            k++;
          }
          if (depth < 3) out.push(...stringsIn(line.slice(j + 2, k - 1), base + j + 2, depth + 1));
          text += '${}';
          j = k;
        } else {
          text += line[j];
          j++;
        }
      }
      out.push({ value: text, index: base + i });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function findPlaceholders(text: string, file: FileInfo): Hit[] {
  const lines = splitLines(text);
  const kind = sourceKind(file.path);
  const style = commentStyleForPath(file.lang, file.path);
  const commentless = splitLines(maskCommentsOnly(text, style));
  const masked = maskCode(text, maskFamily(file.path));
  const maskedLines = splitLines(masked);
  const out: Hit[] = [];
  const add = (line: number, column: number, sig: string, message: string, fix: string) => out.push({ line, column, sig, message, fix });

  // Comments: TODO: implement, "your code here".
  if (style !== 'none') {
    for (const span of findComments(text, style)) {
      const body = span.body.replace(/^[\s*]+/, '').replace(/[\s*]+$/, '');
      if (TODO_IMPLEMENT.test(body) || YOUR_CODE_HERE.test(body)) {
        const shown = snippet(body, 50);
        add(span.line, 1, `todo|${normalizeWhitespace(body)}`, `The comment "${shown}" marks code that was never written.`, 'Write the implementation, or tell the user this part is not done.');
      }
    }
  }

  lines.forEach((_line, i) => {
    const code = commentless[i] ?? '';
    const bare = maskedLines[i] ?? '';
    const n = i + 1;
    // throw new Error('Not implemented') and friends.
    const thrown = /\bthrow\s+(?:new\s+)?([\w.\\]*(?:Error|Exception))\s*\(\s*(['"`])(.*?)\2\s*\)?/.exec(code) ?? /\bthrow\s+(['"`])(.*?)\1/.exec(code);
    if (thrown) {
      const msg = thrown.length === 4 ? (thrown[3] ?? '') : (thrown[2] ?? '');
      if (NOT_IMPLEMENTED.test(msg) && !inAbstractClass(masked, lines, i)) {
        add(n, (thrown.index ?? 0) + 1, `throw|${normalizeWhitespace(msg)}`, `\`${snippet(thrown[0], 60)}\` leaves this code path unimplemented.`, 'Implement this code path, or tell the user it is not done.');
      }
    }
    if (/\bthrow\s+new\s+(?:System\.)?NotImplementedException\s*\(/.test(bare) && kind === 'csharp') add(n, 1, 'throw|NotImplementedException', '`throw new NotImplementedException()` leaves this method unimplemented.', 'Implement the method, or tell the user it is not done.');
    if (kind === 'rust' && /\btodo!\s*\(/.test(bare)) add(n, bare.indexOf('todo!') + 1, 'todo!', '`todo!()` leaves this code path unimplemented and panics when it runs.', 'Implement this code path, or tell the user it is not done.');
    if (kind === 'kotlin' && /(^|[^.\w])TODO\s*\(/.test(bare)) add(n, bare.indexOf('TODO') + 1, 'TODO()', '`TODO()` leaves this code path unimplemented and throws when it runs.', 'Implement this code path, or tell the user it is not done.');
    if (kind === 'go' || kind === 'swift' || kind === 'python') {
      const call = kind === 'go' ? /\bpanic\s*\(\s*"([^"]*)"/.exec(code) : kind === 'swift' ? /\bfatalError\s*\(\s*"([^"]*)"/.exec(code) : /\braise\s+NotImplementedError\s*\(\s*(['"])(.*?)\1/.exec(code);
      const msg = call ? (kind === 'python' ? call[2] : call[1]) ?? '' : '';
      if (call && NOT_IMPLEMENTED.test(msg) && !(kind === 'python' && /^\s*(not\s+(yet\s+)?implemented\.?)?\s*$/i.test(msg))) {
        add(n, (call.index ?? 0) + 1, `call|${normalizeWhitespace(msg)}`, `\`${snippet(call[0], 60)})\` leaves this code path unimplemented.`, 'Implement this code path, or tell the user it is not done.');
      }
    }
    // String values: lorem ipsum, key placeholders, example.com endpoints.
    if (/placeholder/i.test(code)) return;
    for (const s of stringsIn(code)) {
      if (/\blorem\s+ipsum\b/i.test(s.value)) {
        add(n, s.index + 1, 'lorem', 'Lorem ipsum placeholder text is in code that ships with the app.', 'Replace it with the real text.');
        continue;
      }
      const value = s.value.trim();
      if (KEY_PLACEHOLDER.test(value)) {
        add(n, s.index + 1, `key|${value}`, `"${snippet(value, 40)}" is a placeholder value in runtime code.`, 'Read the real value from configuration or an environment variable.');
        continue;
      }
      const url = EXAMPLE_URL.exec(s.value);
      if (url && !exampleUrlIsFine(code, s.index)) {
        add(n, s.index + 1, `url|${url[0]}`, `\`${snippet(url[0], 60)}\` is a placeholder endpoint in runtime code.`, 'Use the real endpoint, or read it from configuration.');
      }
    }
    // JSX text: lorem ipsum outside quotes.
    if (CODE.has(file.lang) && /\blorem\s+ipsum\b/i.test(code) && !stringsIn(code).some((s) => /\blorem\s+ipsum\b/i.test(s.value))) {
      add(n, code.search(/\blorem\s+ipsum\b/i) + 1, 'lorem', 'Lorem ipsum placeholder text is in code that ships with the app.', 'Replace it with the real text.');
    }
  });
  return out;
}

/** `new URL(path, 'https://example.com')` parses a relative URL; `example:` keys document an API. */
function exampleUrlIsFine(code: string, index: number): boolean {
  const before = code.slice(0, index);
  if (/new\s+URL\s*\([^)]*,\s*$/.test(before)) return true;
  if (/\b(examples?|placeholder|description|docs?|default(?:Value)?|sample)\s*[:=]\s*\[?\s*$/i.test(before)) return true;
  if (/\.(describe|example|openapi)\s*\(\s*\{?[^)]*$/.test(before)) return true;
  return false;
}

/** Inside `abstract class` or a class named Abstract... or Base..., where throwing is how a method asks to be overridden. */
function inAbstractClass(masked: string, lines: string[], index: number): boolean {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += (lines[i] ?? '').length + 1;
  let depth = 0;
  for (let k = offset; k >= 0; k--) {
    const ch = masked[k];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const lineStart = masked.lastIndexOf('\n', k - 1) + 1;
      const header = masked.slice(Math.max(0, lineStart - 200), k);
      if (/\babstract\s+class\b|\bclass\s+(?:Abstract|Base)\w*/.test(header.split('\n').slice(-3).join(' '))) return true;
    }
  }
  return false;
}

function maskCommentsOnly(text: string, style: ReturnType<typeof commentStyleForPath>): string {
  if (style === 'none') return text;
  const chars = text.split('');
  for (const s of findComments(text, style)) for (let k = s.start; k < s.end && k < chars.length; k++) if (chars[k] !== '\n') chars[k] = ' ';
  return chars.join('');
}

const QUICK = /implement|TODO|todo!|lorem|your|replace|insert|enter|change[-_]?me|example\.(com|org|net)|NotImplemented|fatalError|panic/i;

export const placeholder: Rule = {
  meta: {
    id: 'hygiene/placeholder',
    level: 'warn',
    scope: 'diff',
    title: 'Placeholder left in runtime code',
    summary: '`throw new Error(\'Not implemented\')` and its equivalents, `TODO: implement`, lorem ipsum, `your-api-key-here` values, or example.com endpoints added to runtime code.',
    why: 'Agents stub out work they did not finish and report the task as done. The placeholder compiles, so it reaches users as a crash, a fake value, or a request to a domain nobody owns.',
    fix: 'Replace the placeholder with the real implementation or value, or tell the user what is left to do.',
  },
  appliesTo: isRuntimeCode,
  project: prepareRun,
  diff(ctx) {
    if (ctx.after === null) return;
    const changes = changesOf(ctx);
    if (!changes.added.some((l) => QUICK.test(l.text))) return;
    const after = findPlaceholders(ctx.after, ctx.file);
    if (after.length === 0) return;
    const before = changes.before === null ? [] : findPlaceholders(changes.before, ctx.file);
    for (const hit of newOccurrences(after, before, changes.addedLines)) {
      ctx.report({ line: hit.line, column: hit.column, message: hit.message, fix: hit.fix, key: hit.sig });
    }
  },
};
