import type { Rule } from '../types.ts';

/**
 * Invisible and direction-changing characters. In agent instruction and
 * config files they hide instructions from the people who review the file
 * ("rules file backdoor", ASCII smuggling with Unicode tag characters); in
 * source code, bidi controls make code display differently from how it runs
 * (Trojan Source, CVE-2021-42574).
 */

export type HiddenKind = 'bidi' | 'zero-width' | 'tag' | 'variation-selector' | 'mark';

export interface HiddenUnicode {
  /** UTF-16 offset of the first character of the run. */
  index: number;
  /** UTF-16 length of the run. */
  length: number;
  line: number;
  column: number;
  kind: HiddenKind;
  codePoints: number[];
  level: 'block' | 'warn';
  /** Short description for messages, for example "a right-to-left override (U+202E)". */
  what: string;
  /** Set when the run is part of an emoji: a joiner between two emoji, or the tags of a subdivision flag. */
  emoji?: 'joiner' | 'flag';
}

export interface HiddenUnicodeOptions {
  /** The text is an agent instruction or config file: zero-width characters count too. */
  agentFile?: boolean;
}

const NAMES: Record<number, string> = {
  0x202a: 'left-to-right embedding',
  0x202b: 'right-to-left embedding',
  0x202c: 'pop directional formatting',
  0x202d: 'left-to-right override',
  0x202e: 'right-to-left override',
  0x2066: 'left-to-right isolate',
  0x2067: 'right-to-left isolate',
  0x2068: 'first strong isolate',
  0x2069: 'pop directional isolate',
  0x200b: 'zero width space',
  0x200c: 'zero width non-joiner',
  0x200d: 'zero width joiner',
  0x2060: 'word joiner',
  0x2061: 'invisible function application',
  0x2062: 'invisible times',
  0x2063: 'invisible separator',
  0x2064: 'invisible plus',
  0xfeff: 'zero width no-break space',
  0x180e: 'Mongolian vowel separator',
  0x200e: 'left-to-right mark',
  0x200f: 'right-to-left mark',
  0x061c: 'Arabic letter mark',
  0x3164: 'Hangul filler',
  0x115f: 'Hangul choseong filler',
  0x1160: 'Hangul jungseong filler',
  0xffa0: 'halfwidth Hangul filler',
};

function classify(cp: number): HiddenKind | null {
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi';
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag';
  if (cp >= 0xe0100 && cp <= 0xe01ef) return 'variation-selector';
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c) return 'mark';
  if ((cp >= 0x200b && cp <= 0x200d) || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x180e || cp === 0x3164 || cp === 0x115f || cp === 0x1160 || cp === 0xffa0) return 'zero-width';
  return null;
}

const QUICK = /[\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0]|\udb40[\udc00-\udc7f\udd00-\uddef]/;
const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const PICTO = /\p{Extended_Pictographic}/u;
const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Syriac}\p{Script=Mongolian}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** The code point before `index` (skipping variation selector 16 and skin tone modifiers), or null. */
function previousBase(chars: number[], i: number): number | null {
  let j = i - 1;
  while (j >= 0 && (chars[j] === 0xfe0f || ((chars[j] as number) >= 0x1f3fb && (chars[j] as number) <= 0x1f3ff))) j--;
  return j >= 0 ? (chars[j] as number) : null;
}

/**
 * Hidden or direction-changing characters in a text, grouped into runs. Used
 * by agent/hidden-unicode and by the hook runtime before content is written.
 */
export function findHiddenUnicode(text: string, options: HiddenUnicodeOptions = {}): HiddenUnicode[] {
  if (!QUICK.test(text)) return [];
  const out: HiddenUnicode[] = [];
  const lines = text.split('\n');
  let offset = 0;
  lines.forEach((lineText, lineIndex) => {
    const lineStart = offset;
    offset += lineText.length + 1;
    if (!QUICK.test(lineText)) return;
    const rtlLine = RTL_LETTER.test(lineText);
    // Code points with their UTF-16 offsets.
    const cps: number[] = [];
    const at: number[] = [];
    for (let i = 0; i < lineText.length; ) {
      const cp = lineText.codePointAt(i) as number;
      cps.push(cp);
      at.push(i);
      i += cp > 0xffff ? 2 : 1;
    }
    let i = 0;
    while (i < cps.length) {
      const kind = classify(cps[i] as number);
      if (!kind || (cps[i] === 0xfeff && lineIndex === 0 && i === 0)) {
        i++;
        continue;
      }
      // A run of hidden characters of any kind.
      let j = i;
      while (j < cps.length && classify(cps[j] as number) !== null) j++;
      const run = cps.slice(i, j);
      const { level, emoji } = runLevel(run, cps, i, j, rtlLine, options);
      if (level) {
        const startUnit = at[i] as number;
        const endUnit = j < at.length ? (at[j] as number) : lineText.length;
        out.push({
          index: lineStart + startUnit,
          length: endUnit - startUnit,
          line: lineIndex + 1,
          column: startUnit + 1,
          kind: mainKind(run),
          codePoints: run,
          level,
          what: describe(run),
          ...(emoji ? { emoji } : {}),
        });
      }
      i = j;
    }
  });
  return out;
}

function mainKind(run: number[]): HiddenKind {
  const kinds = run.map((cp) => classify(cp) as HiddenKind);
  for (const k of ['tag', 'bidi', 'variation-selector', 'zero-width', 'mark'] as const) if (kinds.includes(k)) return k;
  return 'zero-width';
}

interface RunLevel {
  level: 'block' | 'warn' | null;
  emoji?: 'joiner' | 'flag';
}

function runLevel(run: number[], cps: number[], start: number, end: number, rtlLine: boolean, options: HiddenUnicodeOptions): RunLevel {
  const level = (l: 'block' | 'warn' | null): RunLevel => ({ level: l });
  const kinds = new Set(run.map((cp) => classify(cp) as HiddenKind));
  const before = previousBase(cps, start);
  const after = end < cps.length ? (cps[end] as number) : null;
  const beforeChar = before === null ? '' : String.fromCodePoint(before);
  const afterChar = after === null ? '' : String.fromCodePoint(after);
  // Emoji tag sequences (subdivision flags such as England): black flag, tag letters, cancel tag.
  if (kinds.size === 1 && kinds.has('tag')) {
    const flag = before === 0x1f3f4 && run[run.length - 1] === 0xe007f && run.length <= 8 && run.slice(0, -1).every((cp) => (cp >= 0xe0061 && cp <= 0xe007a) || (cp >= 0xe0030 && cp <= 0xe0039));
    return flag ? { level: 'warn', emoji: 'flag' } : level('block');
  }
  if (kinds.has('tag')) return level('block');
  // One or two selectors after an ideograph are ideographic variation sequences (Japanese text);
  // long runs after an emoji or a letter are the way data is smuggled with variation selectors.
  if (kinds.has('variation-selector')) return level(run.length >= 3 ? 'block' : null);
  if (kinds.has('bidi')) return level(rtlLine ? 'warn' : 'block');
  // Only marks and zero-width characters from here on.
  const onlyJoiners = run.every((cp) => cp === 0x200d || cp === 0x200c);
  if (onlyJoiners && run.length === 1) {
    // Emoji ZWJ sequences (family, profession, and flag emoji).
    if (run[0] === 0x200d && PICTO.test(beforeChar) && PICTO.test(afterChar)) return options.agentFile ? { level: 'warn', emoji: 'joiner' } : level(null);
    // Persian, Arabic, and Indic text use joiners between letters.
    if (JOINING_SCRIPT.test(beforeChar) || JOINING_SCRIPT.test(afterChar)) return level(null);
  }
  if (kinds.size === 1 && kinds.has('mark')) return level(rtlLine || !options.agentFile ? null : 'warn');
  if (!options.agentFile) return level(null);
  return level('block');
}

function describe(run: number[]): string {
  const tags = run.filter((cp) => cp >= 0xe0000 && cp <= 0xe007f).length;
  if (tags > 0) return tags === 1 ? 'a Unicode tag character (U+E0000 to U+E007F)' : `${tags} Unicode tag characters (U+E0000 to U+E007F)`;
  const vs = run.filter((cp) => cp >= 0xe0100 && cp <= 0xe01ef).length;
  if (vs > 0) return `${vs === 1 ? 'a variation selector' : `${vs} variation selectors`} from U+E0100 to U+E01EF`;
  const distinct = [...new Set(run)];
  const named = distinct.slice(0, 3).map((cp) => `${NAMES[cp] ?? 'invisible character'} (${hex(cp)})`);
  const more = distinct.length > 3 ? `, and ${distinct.length - 3} more` : '';
  return `${run.length > 1 ? `${run.length} invisible characters: ` : 'a '}${named.join(', ')}${more}`;
}

export const hiddenUnicode: Rule = {
  meta: {
    id: 'agent/hidden-unicode',
    level: 'block',
    scope: 'file',
    title: 'Hidden Unicode in agent files or code',
    summary: 'Invisible characters (zero-width characters, Unicode tag characters) in agent instruction and config files, and bidi control characters in any file.',
    why: 'Models read characters that people reviewing the file cannot see, so hidden text in AGENTS.md, rules, or skills can carry instructions nobody approved. Bidi controls reorder how code is displayed, so reviewed code can differ from the code that runs (Trojan Source, CVE-2021-42574).',
    fix: 'Delete the hidden characters; if the file needs right-to-left text, write it without direction override characters.',
    cwe: ['CWE-1007', 'CWE-451'],
    owasp: ['ASI01', 'ASI06'],
    references: ['https://trojansource.codes/', 'https://nvd.nist.gov/vuln/detail/CVE-2021-42574'],
    levels:
      'block for tag characters, variation selector runs, and zero-width characters in agent files, and for bidi controls in any file; warn for bidi controls on lines with right-to-left text, zero-width joiners inside emoji sequences in agent files, subdivision flag emoji, and hidden characters in tests and docs.',
  },
  appliesTo: (file) => !file.generated,
  text(ctx) {
    const agentFile = ctx.file.contexts.has('agent');
    const lowStakes = !agentFile && (ctx.file.contexts.has('test') || ctx.file.contexts.has('docs') || ctx.file.contexts.has('example'));
    // One finding per line: the most severe run on it.
    const byLine = new Map<number, HiddenUnicode>();
    for (const h of findHiddenUnicode(ctx.text, { agentFile })) {
      const current = byLine.get(h.line);
      if (!current || (current.level === 'warn' && h.level === 'block')) byLine.set(h.line, h);
    }
    for (const h of byLine.values()) {
      const level = lowStakes ? 'warn' : h.level;
      const where = agentFile ? 'This line of an agent file has' : 'This line has';
      const effect =
        h.emoji === 'joiner'
          ? 'inside an emoji sequence, which is how combined emoji are written but is also invisible in review'
          : h.emoji === 'flag'
            ? 'in a subdivision flag emoji, which is how regional flags are written but is also invisible in review'
            : h.kind === 'bidi'
              ? 'which changes the order in which the text is displayed'
              : h.kind === 'mark'
                ? 'which is invisible when the file is displayed'
                : 'which people cannot see when they review the file but models read';
      ctx.report({
        line: h.line,
        column: h.column,
        endColumn: h.column + h.length,
        level,
        message: `${where} ${h.what}${h.emoji ? ' ' : ', '}${effect}.`,
        ...(h.emoji ? { fix: 'Keep it if the emoji shows as one symbol; otherwise delete the hidden characters.' } : {}),
        evidence: `${h.codePoints.length === 1 ? hex(h.codePoints[0] as number) : `${hex(h.codePoints[0] as number)} and ${h.codePoints.length - 1} more`} at column ${h.column}`,
        key: `${h.kind}:${h.column}`,
      });
    }
  },
};
