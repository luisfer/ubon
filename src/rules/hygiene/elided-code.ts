import { splitLines } from '../../core/diff.ts';
import { findComments } from '../../lang/comments.ts';
import { changesOf, commentStyleForPath, isFixtureData, newOccurrences, normalizeWhitespace, prepareRun, snippet, type Occurrence } from '../integrity/shared.ts';
import type { Rule } from '../types.ts';

/**
 * Placeholder comments that stand in for code a model dropped while
 * rewriting a file: `// ... existing code ...`, `// rest of the
 * implementation`, `// (unchanged)`, `/* ... *\/` as the only content of a
 * body, `<!-- ... unchanged ... -->`, `# ... rest of file`. Only comments on
 * lines added in the change are reported, and only when the whole comment
 * is such a placeholder: `// ...and then we retry` is prose, not elision.
 */

const E = String.raw`(?:\.{2,}|…)`;
const NOUN = String.raw`(?:code|implementations?|imports?|methods?|functions?|logic|contents?|tests?|test cases|cases|styles?|props|properties|fields|routes|handlers|exports|components?|config(?:uration)?|settings|types|interfaces|state|hooks|jsx|markup|html|template|body|file|class|module|lines|definitions|declarations|helpers|utils|utilities|setup|options|endpoints|queries|mutations|reducers|actions|selectors|middleware|rules|validations?|schemas?|models?|columns|dependencies|items|entries|elements|children|sections?|steps|functionality|features|behaviou?r|form|forms|page|pages|layout|list|table|menu|sidebar|header|footer|tabs|modal|buttons|inputs|cards|script|stuff)`;
const STRONG = String.raw`(?:code|implementations?|logic|contents?)`;
const DET = String.raw`(?:(?:the|this|your|all|any)\s+)?`;
const QUAL = String.raw`(?:existing|previous|original|remaining|other|old|unchanged|same|prior|current)`;
const MODS = String.raw`(?:\s*[,:;-]?\s*(?:here|below|above|goes\s+here|as\s+(?:is|before)|remains?\s+(?:the\s+same|unchanged|as\s+is)|stays?\s+the\s+same|(?:is|are)\s+(?:unchanged|the\s+same)|unchanged|\(unchanged\)|omitted|elided|not\s+shown|(?:omitted\s+)?for\s+brevity|continues?|etc\.?))*`;
const KEEP = String.raw`(?:(?:keep|keeping|leave|leaving|retain|preserve|preserving|include|including)\s+)?`;
const CHANGE = String.raw`(?:(?:remains?|stays?)\s+(?:the\s+same|unchanged|as\s+is)|(?:is|are)\s+unchanged|unchanged|omitted(?:\s+for\s+brevity)?|not\s+shown)`;

const whole = (re: string) => new RegExp(`^(?:${re})$`, 'i');

/** Phrases that mean "code was left out" on their own. */
const STRONG_PHRASES = [
  whole(String.raw`${DET}(?:rest|remainder)\s+of\s+${DET}(?:${QUAL}\s+)?${NOUN}(?:\s+(?:of|in|for)\s+${DET}\w+)?${MODS}`),
  whole(String.raw`(?:${STRONG}\s+)?(?:omitted|truncated)\s+for\s+brevity`),
  whole(String.raw`same\s+as\s+(?:before|above|the\s+original|previous)`),
  whole(String.raw`${KEEP}${DET}${QUAL}\s+${STRONG}${MODS}`),
  whole(String.raw`${DET}${STRONG}\s+${CHANGE}`),
  whole(String.raw`(?:everything\s+else|the\s+rest|rest)\s+(?:${CHANGE}|(?:is|remains?)\s+as\s+(?:is|before))`),
];
/** Phrases that also appear as ordinary comments ("unchanged", "other methods"); they count only with an ellipsis or brackets. */
const WEAK_PHRASES = [
  whole(String.raw`unchanged|no\s+changes?|as\s+before`),
  whole(String.raw`${KEEP}${DET}${QUAL}\s+${NOUN}${MODS}`),
  whole(String.raw`${DET}${NOUN}\s+${CHANGE}`),
];

export type ElisionKind = 'phrase' | 'bare';

/** Whether a comment body is an elision placeholder; `onlyContent` means it is the only thing inside a `{}`, `[]`, or `()`. */
export function elisionKind(rawBody: string, onlyContent: boolean): ElisionKind | null {
  let body = normalizeWhitespace(rawBody.replace(/^[\s*]+/, '').replace(/[\s*]+$/, ''));
  if (!body) return null;
  if (new RegExp(`^${E}$`).test(body)) return onlyContent ? 'bare' : null;
  let marked = false;
  const lead = new RegExp(`^${E}\\s*`);
  const trail = new RegExp(`\\s*${E}\\s*[.:;!]?$`);
  if (lead.test(body)) {
    marked = true;
    body = body.replace(lead, '');
  }
  if (trail.test(body)) {
    marked = true;
    body = body.replace(trail, '');
  }
  const bracketed = /^[([].*[)\]]$/.exec(body);
  if (bracketed) {
    marked = true;
    body = body.slice(1, -1).trim();
  }
  body = body.replace(/[.:;!]$/, '').trim();
  if (!body) return null;
  if (STRONG_PHRASES.some((re) => re.test(body))) return 'phrase';
  if ((marked || onlyContent) && WEAK_PHRASES.some((re) => re.test(body))) return 'phrase';
  return null;
}

/** Offsets of text outside fenced code blocks in Markdown. */
function fencedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\1[ \t]*(?=\n|$)|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

const OPENERS = new Set(['{', '[', '(']);
const CLOSERS = new Set(['}', ']', ')']);

interface Hit extends Occurrence {
  column: number;
  shown: string;
}

function findElisions(text: string, lang: Parameters<typeof commentStyleForPath>[0], path: string): Hit[] {
  const style = commentStyleForPath(lang, path);
  if (style === 'none') return [];
  const spans = findComments(text, style);
  if (spans.length === 0) return [];
  const fences = lang === 'markdown' ? fencedRanges(text) : [];
  const lines = splitLines(text);
  // Comment text blanked out, to look at the code around a comment.
  const chars = text.split('');
  for (const s of spans) for (let k = s.start; k < s.end && k < chars.length; k++) if (chars[k] !== '\n') chars[k] = ' ';
  const blank = chars.join('');
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const out: Hit[] = [];
  for (const span of spans) {
    if (fences.some(([a, b]) => span.start >= a && span.start < b)) continue;
    const lineStart = starts[span.line - 1] ?? 0;
    const lineText = lines[span.line - 1] ?? '';
    const lineEndOffset = lineStart + lineText.length;
    // Own line: only whitespace, JSX braces, or other comments around it.
    const around = blank.slice(lineStart, Math.min(lineEndOffset, blank.length));
    const ownLine = /^[\s{}()[\],;]*$/.test(around);
    let before = span.start - 1;
    while (before >= 0 && /\s/.test(blank[before] ?? '')) before--;
    let after = span.end;
    while (after < blank.length && /\s/.test(blank[after] ?? '')) after++;
    const onlyContent = OPENERS.has(blank[before] ?? '') && CLOSERS.has(blank[after] ?? '');
    if (!ownLine && !onlyContent) continue;
    const kind = elisionKind(span.body.replace(/\r/g, ''), onlyContent);
    if (!kind) continue;
    out.push({ line: span.line, column: span.start - lineStart + 1, shown: snippet(text.slice(span.start, span.end), 60), sig: normalizeWhitespace(span.body) });
  }
  return out;
}

export const elidedCode: Rule = {
  meta: {
    id: 'hygiene/elided-code',
    level: 'block',
    scope: 'diff',
    title: 'Placeholder comment where code was dropped',
    summary: 'A comment such as `// ... existing code ...`, `// rest of the implementation`, or `/* ... */` as the only content of a body, added in the change.',
    why: 'Models that rewrite a whole file sometimes write a placeholder comment instead of repeating code they did not change, and the code behind it is deleted. The file may still compile while a function body, a list of routes, or a component is gone.',
    fix: 'Restore the code the comment replaced from the previous version of the file, and remove the comment.',
    cwe: ['CWE-1164'],
  },
  appliesTo: (file) => !file.generated && !isFixtureData(file.path) && (file.lang === 'markdown' || !file.contexts.has('docs')),
  project: prepareRun,
  diff(ctx) {
    if (ctx.after === null) return;
    const changes = changesOf(ctx);
    if (!changes.added.some((l) => /\.\.|…|rest\s+of|unchanged|existing|omitted|remainder|same\s+as/i.test(l.text))) return;
    const after = findElisions(ctx.after, ctx.file.lang, ctx.file.path);
    if (after.length === 0) return;
    const before = changes.before === null ? [] : findElisions(changes.before, ctx.file.lang, ctx.file.path);
    const noun = ctx.file.lang === 'markdown' ? 'content' : 'code';
    const where = changes.before === null ? 'is missing from this new file' : 'is no longer in the file';
    for (const hit of newOccurrences(after, before, changes.addedLines)) {
      ctx.report({
        line: hit.line,
        column: hit.column,
        message: `\`${hit.shown}\` stands in for ${noun} that ${where}.`,
        fix: `Restore the ${noun} this comment replaced from the previous version of the file, and remove the comment.`,
        key: hit.sig,
      });
    }
  },
};

