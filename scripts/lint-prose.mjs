#!/usr/bin/env node
// Prose lint: the mechanically detectable part of docs/style.md.
//
//   node scripts/lint-prose.mjs            every tracked Markdown file, the skill, and rule metadata
//   node scripts/lint-prose.mjs FILE...    only these files
//
// Code blocks, inline code, HTML comments, front matter, and link targets are
// skipped, so examples of what the guide bans can be quoted in code spans.
// Errors fail the run; warnings are printed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

// Blank non-prose regions but keep line numbers. Image alt text stays in.
const blank = (m) => m.replace(/[^\n]/g, ' ');
const prose = (md) => md
  .replace(/^---\n[\s\S]*?\n---\n/, blank)
  .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, blank)
  .replace(/`[^`\n]+`/g, blank)
  .replace(/<!--[\s\S]*?-->/g, blank)
  .replace(/\]\([^)\s]*\)/g, (m) => '](' + ' '.repeat(m.length - 3) + ')');

const rules = [
  // Punctuation and typography
  { id: 'em-dash', level: 'error', re: /[\u{2014}\u{2015}\u{2E3A}\u{2E3B}\u{FE58}\u{FE31}]/u },
  { id: 'en-dash-as-dash', level: 'error', re: /(?<!\d)\u{2013}|\u{2013}(?!\d)/u },
  { id: 'double-hyphen-dash', level: 'error', re: /(?<=[\p{L}\p{N},.)])\s--\s(?=[\p{L}\p{N}(])/u },
  { id: 'curly-quotes', level: 'error', re: /[\u{2018}\u{2019}\u{201A}\u{201B}\u{201C}\u{201D}\u{201E}\u{201F}\u{2032}\u{2033}]/u },
  { id: 'emoji', level: 'error', re: /\p{Emoji_Presentation}|\p{Extended_Pictographic}\u{FE0F}/u },
  { id: 'emoji-shortcode-heading', level: 'error', re: /^#{1,6}[ \t]+:[a-z0-9_+-]+:/m },
  // Narrower options if you allow emoji elsewhere (both tested):
  // { id: 'emoji-heading-start', level: 'error', re: /^#{1,6}[ \t]*(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\u{FE0F})/mu },
  // { id: 'emoji-bullet-start', level: 'error', re: /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\u{FE0F})/mu },
  { id: 'decorative-symbols', level: 'warning', re: /[\u{2192}\u{21D2}\u{2794}\u{279C}\u{27A1}\u{2713}\u{2714}\u{2605}\u{2606}\u{2728}\u{25B6}\u{2022}]/u },
  { id: 'exclamation', level: 'warning', re: /[\p{L}\p{N})][!]+(?=\s|$)/u },
  // Headings and structure (edit the proper-noun allowlist for your project)
  { id: 'heading-colon', level: 'warning', re: /^#{1,6}[ \t]+[^\n:]*[^\s\d]:(?:[ \t]+\S|[ \t]*$)/m },
  { id: 'heading-title-case', level: 'warning', re: new RegExp(String.raw`^#{1,6}[ \t]+(?:[^\p{L}\p{N}\s]+[ \t]+)*(?:[\p{L}\p{N}]{1,3}[.)][ \t]+)?(?![\p{L}\p{N}]{1,3}[.)][ \t])[\p{L}\p{N}]\S*(?:[ \t]+\S+)*?[ \t]+(?!(?:Ubon|GitHub|Actions|Node|Cursor|Claude|Code|Codex|Copilot|Gemini|CLI|MCP|SARIF|JSON|YAML|npm|Lovable|Supabase|Firebase|Stripe|Vercel|Next|Vite|Astro|SvelteKit|Hono|Express|ESLint|OWASP|Windows|Linux|macOS|Git|Agent|Skills|API|Action|Markdown|TypeScript|JavaScript|React|Vue|Svelte|Drizzle|Prisma|Postgres|SQL|RLS|AI|SDK|OpenAI|Anthropic|Google|Devin|Kiro|OpenCode|Amp|Cline|Zed|JetBrains|Junie|Aider|Goose|Factory|Droid|VS|Windsurf)\b)[A-Z]\p{Ll}+`, 'mu') },
  { id: 'marketing-heading', level: 'warning', re: /^#{1,6}[ \t]+(?:why\s+(?:choose\s+)?\S+\?|(?:key\s+|core\s+)?features(?:\s+(?:and|&)\s+benefits)?|(?:final|closing)\s+thoughts|wrapping\s+up|conclusion|in\s+summary|key\s+takeaways|the\s+bottom\s+line|what\s+you(?:'|\u{2019})ll\s+learn|deep\s+dive|under\s+the\s+hood|the\s+future\s+of\s+\S+|unlocking\s+.+)\s*$/im },
  { id: 'bold-lead-in-bullet', level: 'warning', re: /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\*\*|__)(?!`)[^*_`\n]{1,60}?(?::[ \t]*(?:\*\*|__)|(?:\*\*|__):)/m },
  { id: 'hr-before-heading', level: 'warning', whole: true, re: /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*\n(?:[ \t]*\n)*#{1,6}[ \t]/m },
  // Vocabulary
  { id: 'ai-vocab', level: 'error', re: /\b(?:delv(?:e|es|ed|ing)|tapestr(?:y|ies)|testament|realm|pivotal|intricat(?:e|ely)|intricac(?:y|ies)|meticulous(?:ly)?|showcas(?:e|es|ed|ing)|vibrant|garner(?:s|ed|ing)?|interplay|commendable|noteworthy|bolster(?:s|ed|ing)?)\b/i },
  { id: 'marketing-words', level: 'error', re: /\b(?:seamless(?:ly)?|cutting[- ]edge|game[- ]chang(?:er|ers|ing)|ever[- ]evolving|next[- ]gen(?:eration)?|state[- ]of[- ]the[- ]art|world[- ]class|best[- ]in[- ]class|enterprise[- ]grade|blazing(?:ly)?[- ]fast|lightning[- ]fast|effortless(?:ly)?|supercharg(?:e|es|ed|ing)|revolutioniz(?:e|es|ed|ing)|unparalleled|groundbreaking|empower(?:s|ed|ing)?|elevate(?:s)?\s+your)\b/i },
  { id: 'context-words', level: 'warning', re: /\b(?:leverag(?:e|es|ed|ing)|robust(?:ly|ness)?|powerful|comprehensive(?:ly)?|unlock(?:s|ed|ing)?|navigat(?:e|es|ed|ing)|landscape|crucial|vital|streamlin(?:e|es|ed|ing)|foster(?:s|ed|ing)?|underscor(?:e|es|ed|ing)|enhanc(?:e|es|ed|ing))\b|\bharness(?:es|ed|ing)?\s+(?:the|its|your|our)\s+(?:power|potential|full)\b/i },
  { id: 'ing-tail', level: 'warning', re: /,\s+(?:ensuring|highlighting|underscoring|showcasing|reflecting|fostering|empowering|cementing|solidifying|paving\s+the\s+way|making\s+it\s+(?:an?\s+)?(?:ideal|perfect|essential|invaluable))\b/i },
  { id: 'copula-dodge', level: 'warning', re: /\b(?:serves|stands|acts|functions)\s+as\s+(?:a|an|the)\b|\bboasts?\b|\b(?:is|stands\s+as)\s+a\s+testament\b|\bplays?\s+an?\s+(?:key|pivotal|crucial|vital|significant)\s+role\b/i },
  { id: 'vague-attribution', level: 'warning', re: /\b(?:experts?|studies|research(?:ers)?|industry\s+(?:reports?|leaders)|many\s+(?:developers|teams|users))\s+(?:say|says|agree|suggest|suggests|show|shows|believe|argue|recommend)\b|\btrusted\s+by\s+(?:thousands|millions|developers|teams)\b|\bwidely\s+(?:regarded|considered|recognized)\b/i },
  // Sentence patterns
  { id: 'negative-parallelism', level: 'error', re: /\bnot\s+(?:just|only|merely|simply)\b[^.!?\n]{1,80}?\b(?:but|it(?:'|\u{2019})?s|it\s+is|they(?:'|\u{2019})re)\b|\b(?:is|are)n(?:'|\u{2019})?t\s+(?:just|only|merely|simply)\b|\bit(?:'|\u{2019})?s\s+not\s+[^.;!?\n]{1,60}[,;:]\s*it(?:'|\u{2019})?s\b|\b(?:this|it)\s+(?:is\s+not|isn(?:'|\u{2019})?t)\s+about\b[^.!?\n]{1,60}[.;]\s+(?:it|this)(?:'|\u{2019})?s\s+about\b/i },
  { id: 'clipped-negation', level: 'warning', re: /\b[Nn]o\s+[\p{L}-]+(?:\s+[\p{L}-]+)?[,.]\s+[Nn]o\s+[\p{L}-]+(?:\s+[\p{L}-]+)?[,.]\s+(?:[Nn]o\s+[\p{L}-]+|[Jj]ust)\b/u },
  { id: 'whether-youre', level: 'warning', re: /\bwhether\s+you(?:'|\u{2019})?re\b|\bwhether\s+you\s+are\b/i },
  { id: 'in-todays', level: 'error', re: /\bin\s+today(?:'|\u{2019})?s\b|\bin\s+(?:an?\s+)?(?:era|age|world)\s+(?:where|of|when)\b|\bin\s+the\s+(?:ever[- ])?(?:evolving|changing)\s+(?:landscape|world)\b|\bfast[- ]paced\s+(?:world|landscape|environment)\b|\bgone\s+are\s+the\s+days\b/i },
  { id: 'staged-opener', level: 'error', re: /\b(?:let(?:'|\u{2019})?s|let\s+us|let\s+me)\s+(?:dive|delve|dig|jump|unpack|explore|break\s+(?:it|this|that)\s+down|take\s+a\s+(?:closer\s+|quick\s+)?look)\b|\bdeep[- ]dive\b|\bwithout\s+further\s+ado\b|\bhere(?:'|\u{2019})?s\s+(?:the\s+(?:thing|deal|kicker|catch|truth|secret|best\s+part)|what\s+you\s+need\s+to\s+know|why\s+(?:this|it|that)\s+matters)\b|\blet\s+that\s+sink\s+in\b/i },
  { id: 'rhetorical-reveal', level: 'warning', re: /\b[Tt]he\s+(?:result|catch|kicker|twist|answer|best\s+part|worst\s+part|secret|bottom\s+line)\?\s/u },
  { id: 'mic-drop', level: 'warning', re: /^(?:That(?:'|\u{2019})?s\s+it|Full\s+stop|Period|Simple\s+as\s+that|It\s+just\s+works|Security,\s+simplified)\.?\s*$/imu },
  { id: 'hedge-stack', level: 'warning', re: /\b(?:could|may|might|can)\s+(?:potentially|possibly|perhaps|arguably|conceivably)\b|\b(?:it(?:'|\u{2019})?s|it\s+is)\s+(?:important|crucial|essential|worth)\s+(?:to\s+(?:note|remember|mention|consider|highlight)|noting)\b/i },
  { id: 'transition-stack', level: 'warning', re: /(?:^|[.!?]\s+)(?:Moreover|Furthermore|Additionally|Consequently|Notably|Importantly|Crucially)\b/m },
  { id: 'false-range', level: 'warning', re: /\bfrom\s+(?!v?\d|version\b)[\p{L}][^.,;:\n]{2,40}?\s+to\s+(?!v?\d|version\b)[\p{L}][^.,;:\n]{2,40}/iu },
  { id: 'summary-closer', level: 'error', re: /\b(?:in\s+(?:conclusion|summary|closing)|to\s+(?:sum\s+up|summari[sz]e|conclude)|all\s+in\s+all|at\s+the\s+end\s+of\s+the\s+day|the\s+future\s+(?:looks|is)\s+bright|exciting\s+times\s+ahead)\b/i },
  { id: 'signposting', level: 'warning', re: /\bin\s+this\s+(?:section|guide|article|document|README|post),?\s+(?:we|you)(?:'|\u{2019})?(?:ll|\s+will)\b|\b(?:below|here)\s+you(?:'|\u{2019})?ll\s+find\b|\bthis\s+(?:guide|article|section)\s+will\s+(?:walk|help|show)\b|\bby\s+the\s+end\s+of\s+this\s+(?:guide|section|tutorial|article)\b/i },
  // Chat residue and artifacts
  { id: 'chat-residue', level: 'error', re: /\b(?:I\s+hope\s+(?:this|that)\s+helps|hope\s+this\s+helps|great\s+question|you(?:'|\u{2019})?re\s+absolutely\s+right|certainly!|of\s+course!|absolutely!|I(?:'|\u{2019})?d\s+be\s+happy\s+to|as\s+an\s+AI(?:\s+language\s+model)?|would\s+you\s+like\s+me\s+to|let\s+me\s+know\s+if\s+you(?:'|\u{2019})?d\s+like)\b/i },
  { id: 'sign-off', level: 'warning', re: /\b(?:feel\s+free\s+to|don(?:'|\u{2019})?t\s+hesitate\s+to|happy\s+(?:coding|hacking|scanning|shipping)\b)/i },
  { id: 'knowledge-cutoff', level: 'error', re: /\b(?:as\s+of\s+my\s+(?:last|latest)\s+(?:knowledge\s+)?(?:update|training)|(?:up\s+to|as\s+of)\s+my\s+(?:knowledge\s+)?cutoff|my\s+training\s+data|based\s+on\s+(?:the\s+)?(?:available|provided)\s+(?:information|sources|search\s+results)|while\s+specific\s+details\s+are\s+(?:limited|scarce))\b/i },
  { id: 'chatbot-artifacts', level: 'error', re: /utm_source=(?:chatgpt\.com|openai|copilot\.com)|referrer=grok\.com|contentReference\[oaicite:\d+\]|oai_citation|(?:cite)?turn\d+(?:search|news|file|image)\d+|\[cite:\s*\d+(?:,\s*\d+)*\]|\[(?:attached_file|web):\d+\]|grok[-_]card|\u{3010}\d+\u{2020}/u },
  { id: 'placeholder', level: 'warning', re: /\b(?:your[-_]?username|your[-_]?org(?:anization)?|INSERT_[A-Z_]+|\d{4}-(?:XX|xx)-(?:XX|xx))\b|\[(?:Your|Insert|Project)\s[^\]\n]{1,40}\]/u },
  { id: 'absolute-claims', level: 'warning', re: /\b(?:zero\s+false\s+positives|100\s*%\s+(?:secure|accurate|coverage)|catch(?:es)?\s+(?:all|every)\s+(?:vulnerabilit(?:y|ies)|bugs?|issues?)|bulletproof|unhackable|military[- ]grade|fully\s+(?:secure|compliant))\b/i },
];


// These files quote the patterns they ban.
const EXCLUDE = /^(plan\/writing-style\.md|docs\/style\.md|fixtures\/|corpus\/|node_modules\/)/;

function lintText(label, raw, isMarkdown) {
  const text = isMarkdown ? prose(raw) : raw;
  const lines = text.split('\n');
  const out = [];
  for (const r of rules) {
    const hits = r.whole
      ? [...text.matchAll(new RegExp(r.re.source, r.re.flags + 'g'))].map((m) => text.slice(0, m.index).split('\n').length)
      : lines.flatMap((l, i) => (r.re.test(l) ? [i + 1] : []));
    for (const line of hits) out.push({ where: `${label}:${line}`, level: r.level, id: r.id });
  }
  return out;
}

const args = process.argv.slice(2);
let files = args;
if (files.length === 0) {
  files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md', '*.mdx'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !EXCLUDE.test(f));
}
const results = [];
for (const file of files) results.push(...lintText(file, readFileSync(join(root, file), 'utf8'), true));

if (args.length === 0) {
  // Rule titles, messages, and fixes are prose too.
  const { RULES } = await import('../src/rules/index.ts');
  for (const rule of RULES) {
    for (const field of ['title', 'summary', 'why', 'fix', 'levels']) {
      const value = rule.meta[field];
      if (typeof value === 'string') results.push(...lintText(`rule ${rule.meta.id} ${field}`, value, false).map((r) => ({ ...r, where: r.where.replace(/:1$/, '') })));
    }
  }
}

let errors = 0;
for (const r of results) {
  console.log(`${r.where}: [${r.level}] ${r.id}`);
  if (r.level === 'error') errors++;
}
const warnings = results.length - errors;
console.log(`prose lint: ${errors} errors, ${warnings} warnings in ${files.length} files${args.length === 0 ? ' and the rule metadata' : ''}`);
process.exit(errors ? 1 : 0);
