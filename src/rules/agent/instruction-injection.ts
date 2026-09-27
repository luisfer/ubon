import type { Rule } from '../types.ts';
import { hostOf, isLocalHost } from './shell-analysis.ts';

/**
 * Prompt-injection phrasing in files agents load as instructions: telling the
 * agent to ignore its instructions, to hide what it does from the user, or to
 * send data somewhere, and long encoded blobs that decode to text. Fenced code
 * blocks, inline code, and quoted phrases are skipped, because documentation
 * that discusses injection quotes these phrases.
 */

interface Pattern {
  id: string;
  re: RegExp;
  what: string;
}

const PATTERNS: Pattern[] = [
  {
    id: 'override',
    // "Ignore previous context" (a --fresh flag) and "override existing rules" (a --force flag) describe tools, so
    // context, messages, existing, and original are left out.
    re: /\b(ignore|disregard|forget)\s+(?:(?:all|any|the|your|every|of|these|those)\s+){0,3}(previous|prior|above|earlier|preceding|former|system|safety)\s+(instructions?|prompts?|rules|directions|guidelines|guidance|constraints|policies)\b|\b(override|bypass)\s+(?:(?:all|any|the|your|every|of)\s+){0,3}(system|safety)\s+(instructions?|prompts?|rules|guidelines|guidance|constraints|policies)\b/i,
    what: 'tells the agent to ignore its previous instructions',
  },
  {
    id: 'override',
    re: /\b(forget|disregard)\s+(everything|all)\s+(you|that)\s+(were|was|have been)\s+(told|given|instructed)\b|\byou are now (in )?(developer|dan|jailbreak|unrestricted|god) mode\b/i,
    what: 'tells the agent to drop its instructions',
  },
];

/**
 * Concealment. Skill files often say "do not mention unavailable
 * capabilities to the user" or "never tell the user changes are saved
 * before the commit succeeds", which is product guidance. An injected
 * instruction hides the agent's own actions or the instructions themselves,
 * so the thing being hidden has to be one of those.
 */
const WHO = String.raw`(?:the\s+)?(?:user|human|developer|operator)s?\b`;
const SELF = new RegExp(
  [
    // The instructions themselves: "these instructions", "this fixture file".
    String.raw`\b(?:this|these|the\s+(?:above|following|previous|preceding|hidden)|my|our)\s+(?:[\w-]+\s+){0,2}?(?:instructions?|rules?|directives?|prompts?|notes?|comments?|sections?|steps?|requests?|guidance|file)\b`,
    // The agent's own actions: "these actions", "your changes", "the commands you ran".
    String.raw`\b(?:this|these|those|your)\s+(?:[\w-]+\s+)?(?:actions?|changes?|modifications?|edits?|commands?|tool\s+calls?|operations?|steps?)\b`,
    String.raw`\b(?:the|any)\s+(?:[\w-]+\s+)?(?:actions?|changes?|modifications?|edits?|commands?|tool\s+calls?|operations?|steps?|files?)\s+(?:that\s+|which\s+)?you\b`,
    String.raw`\b(?:that|what|how)\s+you\s+(?:[\w-]+\s+){0,2}?(?:read|ran|run|executed|added|sent|modified|changed|installed|downloaded|accessed|fetched|uploaded|removed|deleted|called|used|did|made|wrote|created|inserted|need|have\s+done|are\s+doing)\b`,
  ].join('|'),
  'i',
);
// "show" and "explain" are left out: "do not show these steps to the user" is output guidance.
const NEGATED_TELL = new RegExp(
  String.raw`\b(?:do\s+not|don't|dont|never|no\s+need\s+to|must\s+not|should\s+not|shouldn't|mustn't)\s+(?:ever\s+)?(?<verb>tell|inform|notify|alert|mention|reveal|disclose|admit)\b(?<rest>[^.!?\n]{0,120})`,
  'gi',
);
/** "Do not tell the user." and "don't tell the user about this". */
const WHO_OBJECT = new RegExp(String.raw`^\s*${WHO}(?:\s+(?:about|of)\s+(?:this|it|these|that|any\s+of\s+(?:this|it|these)))?\s*[,;:)]?\s*$`, 'i');
/** "Never mention this." and "don't mention it to the user". */
const PRONOUN_OBJECT = new RegExp(String.raw`^\s*(?:this|it|these|anything)(?:\s+(?:to|with)\s+${WHO})?\s*[,;:)]?\s*$`, 'i');
/** Timing and conditions make it honesty or ordering guidance: "until synthesis", "before the commit succeeds", "if you did not". */
const QUALIFIED = /\b(?:if|unless|until|before|after|when|whenever|once)\b/i;
const WITHOUT_TELLING = new RegExp(String.raw`\bwithout\s+(?:telling|informing|notifying|alerting)\s+${WHO}(?<rest>[^.!?\n]{0,60})`, 'i');
const STEALTH = /\b(?:silently|quietly|secretly|covertly|discreetly|stealthily|in\s+the\s+background|behind\s+the\s+scenes)\b/i;
const HIDE_FROM = new RegExp(
  String.raw`\b(?:hide|conceal|keep)\s+(?:this|these|(?:${SELF.source}))\s+(?:(?:a\s+)?(?:secret|hidden|confidential|private)\s+)?from\s+${WHO}(?=\s*(?:[.;,:!)]|$)|\s+(?:and|or|so|until|unless|while|at|during|in)\b)`,
  'i',
);
const MUST_NOT_KNOW = new RegExp(
  String.raw`\bthe\s+(?:user|human)s?\s+(?:must|should|will|does|do|need|needs)\s*(?:not|never|n't)\s+(?:ever\s+)?(?:know|notice|find\s+out|learn|be\s+(?:told|informed|made\s+aware))\b(?<rest>[^.!?\n]{0,60})`,
  'i',
);

/** The sentence of `text` that contains offset `index`. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('. ', index), text.lastIndexOf('! ', index), text.lastIndexOf('? ', index), text.lastIndexOf('\n', index));
  const ends = ['. ', '! ', '? ', '\n'].map((d) => text.indexOf(d, index)).filter((i) => i >= 0);
  return text.slice(start + 1, ends.length > 0 ? Math.min(...ends) : text.length);
}

function concealment(prose: string): string | null {
  for (const m of prose.matchAll(NEGATED_TELL)) {
    const verb = (m.groups?.verb ?? '').toLowerCase();
    const rest = m.groups?.rest ?? '';
    if (QUALIFIED.test(rest)) continue;
    if (SELF.test(rest)) return 'tells the agent to hide its actions or these instructions from the user';
    if (/^(?:tell|inform|notify|alert)$/.test(verb) && WHO_OBJECT.test(rest)) return 'tells the agent to hide something from the user';
    if (verb === 'mention' && PRONOUN_OBJECT.test(rest)) return 'tells the agent to hide something from the user';
  }
  const without = WITHOUT_TELLING.exec(prose);
  if (without) {
    const sentence = prose.slice(0, without.index).split(/[.!?\n]/).pop() ?? '';
    const rest = without.groups?.rest ?? '';
    const aboutSelf = /^\s*(?:about|of)\s+/i.test(rest) && (SELF.test(rest) || /^\s*(?:about|of)\s+(?:this|these|it)\b/i.test(rest));
    const ends = /^\s*[,;:)]?\s*$/.test(rest);
    if (!/\b(?:never|not|no|don't|dont|avoid)\b/i.test(sentence) && (aboutSelf || (ends && STEALTH.test(sentence)))) {
      return 'tells the agent to act without telling the user';
    }
  }
  if (HIDE_FROM.test(prose)) return 'tells the agent to hide something from the user';
  const know = MUST_NOT_KNOW.exec(prose);
  if (know) {
    const rest = know.groups?.rest ?? '';
    if (/^\s*[,;:)]?\s*$/.test(rest) || /^\s*(?:about|of)\s+(?:this|these|it)\b/i.test(rest) || SELF.test(rest)) return 'tells the agent to keep the user from knowing what it does';
  }
  return null;
}

const SEND =
  /\b(?:send|post|upload|exfiltrate|transmit|forward|leak|copy|report|submit)\b[^.\n]{0,80}?(?<noun>\b(?:secrets?|api[ _-]?keys?|access tokens?|tokens|credentials?|passwords?|env(?:ironment)? var(?:iable)?s|ssh keys?|private keys?|conversation|chat history|system prompt|session cookies?|cookies)\b|(?<![\w.])\.env\b)[^.\n]{0,80}?\bto\s+(?<dest>https?:\/\/[^\s)'"<>]+|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b)/i;

const DISCUSSION = /\binjection\b|\bjailbreak|\battack(er|s)?\b|\bmalicious\b|\bexample of\b|\bbeware\b|\bwatch (out )?for\b|\bsuch as\b|\bphrases? like\b/i;

const BASE64_RUN = /[A-Za-z0-9+/]{120,}={0,2}/g;
const HEX_RUN = /\b(?:[0-9a-fA-F]{2}){60,}\b/g;

function printableRatio(text: string): number {
  if (!text) return 0;
  let ok = 0;
  for (const ch of text) if (/[\x20-\x7e\n\r\t]/.test(ch)) ok++;
  return ok / text.length;
}

/** An encoded blob that decodes to readable text, which is how instructions are smuggled past review. */
function decodesToText(blob: string, encoding: 'base64' | 'hex'): boolean {
  try {
    const decoded = Buffer.from(blob, encoding).toString('utf8');
    const words = decoded.split(/\s+/).filter((w) => /^[A-Za-z]{2,}[,.:;!?]?$/.test(w));
    return printableRatio(decoded) > 0.95 && words.length >= 8;
  } catch {
    return false;
  }
}

/** Remove inline code, quoted phrases, and Markdown link targets so only the prose that addresses the agent is matched. */
function proseOnly(line: string): string {
  return line
    .replace(/(`+)[^`]*\1/g, ' ')
    .replace(/"[^"\n]{0,200}"|\u201C[^\u201D\n]{0,200}\u201D|\u2018[^\u2019\n]{0,200}\u2019/g, ' ')
    // Single quotes only when they open after a space and close before a space or punctuation (not apostrophes).
    .replace(/(^|\s)'[^'\n]{3,200}'(?=\s|[.,;:!?)]|$)/g, '$1 ');
}

export const instructionInjection: Rule = {
  meta: {
    id: 'agent/instruction-injection',
    level: 'warn',
    scope: 'file',
    title: 'Prompt injection in agent instructions',
    summary: 'Phrasing in agent instruction files (AGENTS.md, CLAUDE.md, rules, skills, prompts) that tells the agent to ignore previous instructions, to hide actions from the user, or to send data to a URL, and long encoded blobs that decode to text.',
    why: 'Agents follow these files as instructions, and they often come from templates, dependencies, or pull requests that nobody reads closely. Text like this is how a poisoned rules file turns the agent against its user.',
    fix: 'Remove the text, or if the file documents the attack, put the example in a fenced code block or in quotes.',
    cwe: ['CWE-1427'],
    owasp: ['LLM01', 'ASI01', 'ASI06'],
    levels: 'Always warn: the rule reads natural language, and the finding is a reason for a person to read the file, not proof of an attack.',
  },
  appliesTo: (file) =>
    !file.generated &&
    file.contexts.has('agent') &&
    !file.contexts.has('test') &&
    (/\.(md|mdx|mdc|markdown|txt|toml)$/i.test(file.path) || /(^|\/)\.(cursorrules|windsurfrules|clinerules|goosehints)$/.test(file.path)),
  text(ctx) {
    let fence: string | null = null;
    let inComment = false;
    ctx.lines.forEach((raw, i) => {
      const fenceMatch = /^\s*(```+|~~~+)/.exec(raw);
      if (fenceMatch && !inComment) {
        const marker = (fenceMatch[1] as string).slice(0, 3);
        fence = fence === null ? marker : marker === fence ? null : fence;
        return;
      }
      if (fence !== null) return;
      // Split the line into visible text and HTML comments (which a rendered file hides).
      const visible: string[] = [];
      const hidden: string[] = [];
      let rest = raw;
      while (rest.length > 0) {
        if (inComment) {
          const end = rest.indexOf('-->');
          hidden.push(end === -1 ? rest : rest.slice(0, end));
          if (end === -1) break;
          inComment = false;
          rest = rest.slice(end + 3);
          continue;
        }
        const start = rest.indexOf('<!--');
        if (start === -1) {
          visible.push(rest);
          break;
        }
        visible.push(rest.slice(0, start));
        inComment = true;
        rest = rest.slice(start + 4);
      }
      const line = i + 1;
      let finding = findInstructionInjection(visible.join(' '));
      let fromComment = false;
      for (const h of hidden) {
        if (finding) break;
        finding = findInstructionInjection(h);
        fromComment = finding !== null;
      }
      if (!finding) return;
      ctx.report({
        line,
        message: `This agent file ${finding.what}${fromComment ? ', inside an HTML comment that is hidden when the file is rendered' : ''}.`,
        evidence: `[${finding.id} on line ${line}]`,
        key: finding.id,
      });
    });
  },
};

export interface InjectionMatch {
  id: string;
  what: string;
}

/** The first injection pattern in a piece of visible text or one HTML comment. */
export function findInstructionInjection(text: string): InjectionMatch | null {
  if (!text.trim()) return null;
  if (!DISCUSSION.test(text)) {
    const prose = proseOnly(text);
    for (const p of PATTERNS) {
      const m = p.re.exec(prose);
      // "If the project uses pnpm, ignore the previous instructions" is a branch in a procedure.
      if (m && !/\b(?:if|unless|when|whenever)\b/i.test(sentenceAround(prose, m.index))) return { id: `${p.id} phrase`, what: p.what };
    }
    const conceal = concealment(prose);
    if (conceal) return { id: 'conceal phrase', what: conceal };
    const send = SEND.exec(prose);
    const dest = send?.groups?.dest;
    const noun = send?.groups?.noun;
    if (dest && noun) {
      const host = hostOf(dest) ?? dest.toLowerCase();
      if (!isLocalHost(host)) return { id: 'send-data phrase', what: `tells the agent to send ${noun.toLowerCase()} to ${host}` };
    }
  }
  if (/data:[\w/+.-]*;base64,/.test(text)) return null;
  for (const m of text.matchAll(BASE64_RUN)) {
    if (decodesToText(m[0], 'base64')) return { id: 'base64 text', what: `has a base64 blob of ${m[0].length} characters that decodes to text, which hides its content from review` };
  }
  for (const m of text.matchAll(HEX_RUN)) {
    if (decodesToText(m[0], 'hex')) return { id: 'hex text', what: `has a hex blob of ${m[0].length} characters that decodes to text, which hides its content from review` };
  }
  return null;
}
