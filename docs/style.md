# Writing style

The writing rules for Ubon: the README, the docs, skills and playbooks, rule messages, CLI output, the changelog, commit messages, and pull request descriptions, including text that agents write in this repository. Researched on 2026-09-26 for the Ubon 4 plan.

The maintainer's requirement is explicit: no em dashes, and none of the other mannerisms that mark text as machine-written. The catalog below lists 43 of them with sources, a bad example, and a better one. The better examples use Ubon 4's commands.

- Rows cite sources by key; URLs are in [Sources](#sources). An asterisk there marks sources that were checked only through search-engine extracts.
- The signs describe tendencies and prove nothing about authorship. Wikipedia's editors call their list "descriptive, not prescriptive" and warn that fixing surface signs can hide deeper problems. The aim is precise documentation.
- Bad examples sit in code spans, so the linter in section 3 skips them. Numbers in the Better column are illustrative; replace them with measured values.
- The research sandbox's network proxy blocked en.wikipedia.org and most publisher sites, so the Wikipedia page was read through two copies on GitHub: wikitext pulled from the Wikipedia API on 2026-01-12 and a plain-text snapshot committed on 2026-08-11.

## How this applies to Ubon

- The rules cover every piece of text a user or an agent reads: README, docs, skill files, rule titles and messages, fix hints, CLI output, hook messages, changelog, release notes, commit messages, and pull request descriptions.
- Rule messages and hook output are prose too. A finding says what is wrong and what to do in one sentence each, with no adjectives: `fetch() uses a URL from the request body.` then `Fix: check the host against an allowlist before fetching.`
- CLI output has no emoji, no banners, no scores, and no encouragement. It ends with what was not checked.
- The mechanically detectable rules run in CI through `scripts/lint-prose.mjs` (section 3). This file and the rule fixtures are excluded, because they quote what they ban.
- Agents that write in this repository follow the same rules; `AGENTS.md` links here.

## 1. Catalog

### A. Vocabulary

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 1 | AI vocabulary. Words that surged after 2022 and cluster together. | `Delve into the intricate landscape of findings, a testament to meticulous analysis.` | Each finding shows a rule ID, file, and line. `ubon explain <ruleId>` prints the rule. | wp-vocab, kobak, juzek, liang, geng |
| 2 | Marketing adjectives. Praise in place of a measurement. | `A blazing-fast, cutting-edge scanner with seamless, robust CI integration.` | `ubon check` exits with code 1 when it finds a `block` finding, which fails the CI job. | wp-puffery, kobak, vat, google-tone |
| 3 | Inflated verbs such as leverage, unlock, elevate, empower, harness, and supercharge. | `Leverage Ubon to unlock and elevate your security posture.` | Run `ubon check` before each deploy. | kobak, vat |
| 4 | Copula avoidance. "Serves as", "stands as", "boasts", or "features" where "is" or "has" fits. | `Ubon serves as a guardian for your codebase and boasts 200+ rules.` | Ubon is a checker for code and commands. `ubon rules` prints its rules. | wp-copula, geng, humanizer (18) |
| 5 | Significance inflation. Asserts importance instead of stating the fact. | `Ubon plays a pivotal role in the evolving landscape of AI-assisted development.` | Ubon checks AI-written code for hardcoded LLM keys and Server Actions without auth checks. | wp-significance, humanizer (13) |
| 6 | Vague or canned authority. Unnamed experts, "trusted by thousands", "industry best practices". | `Experts agree AI code is risky, and Ubon follows industry best practices.` | OWASP's Top 10 for LLM Applications ranks prompt injection first (LLM01), with a link. | wp-weasel, wp-edit-summaries, belcher, humanizer (17) |

### B. Sentence patterns

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 7 | Negative parallelism. Denies a claim nobody made, sometimes across two sentences. | `Ubon isn't just a linter, it's a safety net for AI code.` | Ubon looks for security bugs that ESLint does not check, such as LLM keys in client bundles. | wp-parallel, wapo, kriss, gorrie, wp-negpar |
| 8 | "Not only X but also Y", the same move with a staged second half. | `Ubon not only finds secrets but also empowers you to fix them.` | `ubon explain web/ssrf` shows how to fix that finding. | wp-parallel, humanizer (1) |
| 9 | Clipped negation runs in the form "No X. No Y. Just Z." | `No config. No cloud. No excuses. Just secure code.` | `ubon check` works without a config file; `ubon init` writes one when you need to change defaults. | wp-parallel, humanizer (1, 2), vat |
| 10 | Reflexive triads. Three adjectives or verbs because three sounds complete. | `Fast, accurate, and developer-friendly. Scan, detect, remediate.` | A 2,000-file repo scans in about 4 seconds on a 2023 laptop (see benchmarks). | wp-ro3, kriss, gorrie, russell, vat |
| 11 | False ranges. "From X to Y" with no scale between the ends. Dropped from the August 2026 snapshot, so treat as contested. | `From solo hackers to Fortune 500 teams, from secrets to supply-chain risk.` | Requires Node.js 22.18 or newer. Rules are grouped by pack in `docs/rules/`. | wp-falserange |
| 12 | "Whether you're A or B" openers that address every reader at once. | `Whether you're a solo vibe coder or a platform team, Ubon has you covered.` | Run `npx ubon@4 check` locally, or add the Ubon GitHub Action to CI. | vat, wp (the page's lead image caption) |
| 13 | Participle tails. A comma plus an "-ing" phrase asserting a benefit. | `Ubon outputs SARIF, ensuring seamless integration and highlighting its commitment to DevSecOps.` | `ubon check --format sarif --output ubon.sarif` writes SARIF 2.1.0 for GitHub code scanning. | wp-superficial, reinhart, humanizer (15) |
| 14 | Elegant variation. Rotating synonyms for one thing. | `Ubon scans your repo. The tool then flags issues, and the engine reports them.` | Ubon scans the repo and prints each issue it finds. | wp-elevar, belcher |
| 15 | Staged fragments and reveals. Dramatic short lines that tease or repeat a claim. | `Install. Scan. Ship. The result? Zero false positives. Full stop.` | Install with `npm install --save-dev ubon`, then run `npx ubon check`. | humanizer (2, 4), vat |
| 16 | Stacked hedges on one claim. A single "perhaps" is ordinary human writing. | `This could potentially help reduce the likelihood of some leaks.` | This rule finds hardcoded LLM keys in source files. It cannot see keys injected at runtime. | humanizer (9), vat, wp-human |

### C. Structure and formatting

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 17 | Emoji as structure, in front of headings and bullets. | `## 🚀 Features` and `- ✅ Detects secrets` | `## What Ubon checks` and `- Hardcoded LLM API keys in client bundles` | wp-emoji, wapo, readmeai, nemesis |
| 18 | Bold lead-in bullets: a bold label and colon, then a sentence restating the label. | `- **Blazing Fast:** Scans your code in seconds.` | A plain bullet with the fact. Flags go in a table with the flag in code font. | wp-list, wp-bold, readmeai, humanizer (19) |
| 19 | Title case headings. | `## Getting Started With Ubon` | `## Get started` | wp-titlecase, google-headings, ms |
| 20 | Colon subtitles in headings. Partly documented: seen in Wikipedia's title-case examples, discouraged by Google and Microsoft. | `## Configuration: Tailoring Ubon to Your Needs` | `## Configure rules` | wp-titlecase, google-headings, ms, markdownlint |
| 21 | Pitch-deck sections such as "Why X?", "Key Features", "Benefits", and "Final Thoughts". | `## Why Ubon?` followed by six bold benefit bullets | `## What it checks`, `## Limitations`, `## Exit codes` | readmeai, vat, wp-challenges |
| 22 | Badge walls. Not a documented AI tell: README generators emit badge rows, but the one anecdote found in research calls badges "a normal, human convention". | fifteen shields.io badges above the first sentence | Three or four badges that carry status (version, CI, license), or none. | readmeai, nemesis |
| 23 | Horizontal rules before every heading, and skipped heading levels. | a `---` line above each heading; `#` followed by `###` | Headings alone, with levels in order (markdownlint MD001). | wp-new, humanizer (20) |
| 24 | Decorative tables. Tiny tables and check-mark cells. | `Secrets: ✅, Auth: ❌` | Yes, No, or Partial with a note. Prose when there are fewer than three rows. | wp-table, wapo, google-md |
| 25 | Heading echo. The first sentence restates the heading. | `## Installation` then `Installing Ubon is easy.` | `## Install` then the command and the Node version it needs. | humanizer (24), google-tone |

### D. Tone

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 26 | Scene-setting openers such as "In today's fast-paced world". Documented in practitioner catalogs only. | `In today's fast-paced world of AI development, security has never been more important.` | AI coding assistants often leave API keys in client code. Ubon finds them. | vat, wp-significance |
| 27 | Cheerleading and sycophancy: praise, exclamation marks, cheer. | `Great question! Ubon handles monorepos too. Happy scanning! 🎉` | To check one package in a monorepo, pass its path: `ubon check packages/api`. | wp-collab, sharma, openai-syc, google-tone |
| 28 | Didactic disclaimers such as "It's important to note". Historical on Wikipedia, still common in docs. | `It's important to note that security is a shared responsibility.` | Ubon reads `ubon.json` and never runs code from your project. | wp-historical, vat |
| 29 | The challenges-and-outlook formula: "Despite these challenges", "the future looks bright". | `While challenges remain, Ubon's future is bright as it evolves with the AI landscape.` | Link the issue tracker for planned work, or cut the paragraph. | wp-challenges, humanizer (13) |

### E. Filler

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 30 | Transition stacking: sentence-initial Moreover, Furthermore, Additionally. Weak alone, strong in a row. | `Additionally, Ubon supports SARIF. Furthermore, it emits JSON. Moreover, it runs as an MCP server.` | Ubon prints text by default; `--format json` and `--format sarif` select the other formats. | wp-vocab, wp-ineffective, vat |
| 31 | Recap endings: "In summary", "Overall", a Conclusion section. | `In summary, Ubon is a powerful tool for secure AI apps.` | End on the last fact or a link, such as `docs/config.md` for every setting. | wp-conclusion, pangram, vat |
| 32 | Signposting. Narrating the document instead of writing it. | `In this section, we will explore how to configure Ubon to suit your needs.` | `ubon.json` sets rule levels, ignored paths, your auth helpers, and the package policy. | wp-collab, vat |

Wordiness is a separate problem. Wikipedia's August 2026 page finds "in order to", "the fact that", and single hedges like "perhaps" more common in human text than in AI text. Cut them for brevity if you like; they are not AI tells.

### F. Punctuation and typography

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 33 | Em dashes (U+2014), the house ban. AI em dashes are often spaced. | `Ubon catches leaks — fast.` | Ubon catches leaks in seconds. Otherwise use a period, comma, colon, or parentheses. | wp-dash, wapo, kriss, altman, humanizer (8) |
| 34 | En dashes (U+2013) and double hyphens used as dashes. | `Fast – and local.` or `Fast -- and local.` | Fast and local. Write ranges as "10 to 20" or "10-20". | wp-dash, wp-list, humanizer (8), vat |
| 35 | Curly quotes and apostrophes. Default in ChatGPT and DeepSeek, rare in Claude and Gemini, and added by smart-quote editors. | `Run “ubon check”; it’s fast.` | Straight quotes and apostrophes, with commands in code font. | wp-curly, humanizer (21) |
| 36 | Decorative arrows and symbols in prose. | `Scan → Fix → Ship` | Run `ubon check`, fix what it reports, then deploy. | humanizer (20), wp-list |

### G. Meta-commentary and chat residue

| # | Mannerism | Bad | Better | Sources |
|---|---|---|---|---|
| 37 | Staged run-ups: "Let's dive in", "Here's the thing", "Without further ado". | `Let's dive in! Here's everything you need to know.` | "Install the CLI:" followed by the code block. | humanizer (4), vat |
| 38 | Chat closers: "I hope this helps", "Feel free to reach out", "Let me know if". | `I hope this helps! Feel free to reach out with any questions.` | Report false positives at https://github.com/luisfer/ubon/issues. | wp-collab, vat |
| 39 | Knowledge-cutoff and gap-filling disclaimers. | `As of my last update, Node 18 is the current LTS.` | Requires Node.js 22.18 or newer; `ubon doctor` checks your environment. | wp-cutoff |
| 40 | Template leftovers: unfilled placeholders. | `git clone https://github.com/yourusername/ubon.git` | The real URL and a real date. | wp-placeholder |
| 41 | Chatbot artifacts: tracking parameters and citation markup pasted from a chat. | `https://owasp.org/?utm_source=chatgpt.com` or `:contentReference[oaicite:0]` | The clean URL. | wp-markup, wp-utm |
| 42 | Diff narration. Reference text that describes what changed instead of what is. | `This command replaces the old slow scanner that caused timeouts.` | Describe current behavior; history goes in `CHANGELOG.md`. | humanizer (25) |
| 43 | Unverified specifics: flags, links, or citations that do not exist. | `Run ubon fix --all to patch every finding.` (Ubon has no fix command.) | `ubon explain <rule>` shows how to fix each finding. | wp-citations |

## 2. Positive rules

Each rule has a check you can automate or do by eye in under a minute.

1. The first sentence says what the tool does and for whom, with no praise words. Check: the first paragraph has at most 30 words and no vocabulary-rule hits.
2. A copyable command appears on the first screen. Check: the first fenced code block starts before line 25. (google-md, gh-readme)
3. Output blocks come from real runs, include the exit code, and are regenerated in CI. Check: a CI job diffs them against a fresh run.
4. One idea per sentence. Check: no sentence over 30 words (a house threshold).
5. Second person, present tense, active voice. Check: Vale `Google.We`, `Google.Will`, `Google.Passive` as warnings. (google-style)
6. Sentence-case headings: a verb for tasks ("Install the CLI"), a noun phrase for concepts, and no "-ing" openers, colon subtitles, or end punctuation. Check: Vale `Google.Headings`, markdownlint MD026. (google-headings, ms)
7. Numbers over adjectives. A claim about speed, coverage, or accuracy carries a number, a unit, and its conditions (version, date, hardware), or it goes.
8. A `## Limitations` section lists what the tool does not detect, known false-positive sources, and supported platforms. (diataxis: reference should "describe and only describe")
9. Every external claim links its source: the standard, CVE, or spec. Check: the vague-attribution rule and a link checker. (wp-weasel, wp-citations)
10. Use "is" and "has". Start instructions with a verb; cut "you can" and "there is". (wp-copula, ms)
11. Put the condition first: "To write SARIF, run ...". (diataxis: "If you want x, do y")
12. Put commands, flags, paths, environment variables, and rule IDs in code font. Link text names its target, never "here". (google-md)
13. Use lists for parallel items, numbered lists for steps, and a table for flags, with no bold labels. Check: the bold-lead-in rule and markdownlint MD036. (google-md, wp-list)
14. Keep the README short and link out. In Diátaxis terms the README orients (what it is, install, first command, where to get help), `docs/config.md` and `docs/output.md` are austere reference, each how-to page covers one task, and rationale lives on its own page. (gh-readme, google-md, diataxis)
15. Keep prose punctuation plain: straight quotes, and no em dashes, en dashes, emoji, decorative arrows, or exclamation marks. Comparison tables say Yes, No, or Partial. Check: the error-level rules below. (google-tone)
16. Change docs in the same pull request as the code, describe current behavior, and leave history to `CHANGELOG.md`. Run every documented command in CI and generate flag tables from `--help`; v3's README already tested its demo ("The expected rule IDs are checked by the test suite so the demo stays honest"); Ubon 4 extends that to every documented command. (google-md, humanizer, wp-citations)
17. End each page on its last useful fact or a link to the next page. (wp-conclusion)

## 3. Enforcing the ban in CI

Error-level rules fail the build: they are mechanical and rarely wrong in English prose. Warning-level rules annotate the pull request for a person to judge. The script blanks front matter, fenced code, inline code, HTML comments, and link targets, keeps line numbers, and still lints image alt text. Exclude this guide (it quotes what it bans), vendored docs, and translations; Spanish uses the em dash (raya) for dialogue. In `CHANGELOG.md`, lint only added lines. The regexes are JavaScript for Node 22 or newer; each was tested against good and bad samples and over the v3 docs.

```js
// lint-prose.mjs: node lint-prose.mjs $(git ls-files '*.md' ':!STYLE.md')
import { readFileSync } from 'node:fs';

// Blank non-prose regions but keep line numbers. Image alt text stays in.
const blank = (m) => m.replace(/[^\n]/g, ' ');
const prose = (md) => md
  .replace(/^---\n[\s\S]*?\n---\n/, blank)                                // front matter
  .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, blank) // fenced code
  .replace(/`[^`\n]+`/g, blank)                                           // inline code
  .replace(/<!--[\s\S]*?-->/g, blank)                                     // HTML comments
  .replace(/\]\([^)\s]*\)/g, (m) => '](' + ' '.repeat(m.length - 3) + ')'); // link targets

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
  { id: 'heading-title-case', level: 'warning', re: new RegExp(String.raw`^#{1,6}[ \t]+(?:[^\p{L}\p{N}\s]+[ \t]+)*(?:[\p{L}\p{N}]{1,3}[.)][ \t]+)?(?![\p{L}\p{N}]{1,3}[.)][ \t])[\p{L}\p{N}]\S*(?:[ \t]+\S+)*?[ \t]+(?!(?:Ubon|GitHub|Actions|Node|Cursor|Claude|Code|Codex|Lovable|Supabase|Next|Vite|ESLint|OWASP|Windows|Linux)\b)[A-Z]\p{Ll}+`, 'mu') },
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

let errors = 0;
for (const file of process.argv.slice(2)) {
  const text = prose(readFileSync(file, 'utf8'));
  const lines = text.split('\n');
  for (const r of rules) {
    const hits = r.whole
      ? [...text.matchAll(new RegExp(r.re.source, r.re.flags + 'g'))].map((m) => text.slice(0, m.index).split('\n').length)
      : lines.flatMap((l, i) => (r.re.test(l) ? [i + 1] : []));
    for (const line of hits) {
      console.log(`${file}:${line}: [${r.level}] ${r.id}`);
      if (r.level === 'error') errors++;
    }
  }
}
process.exit(errors ? 1 : 0);
```

### False-positive risk

- Near zero: `em-dash` (also catches the look-alikes U+2015, U+2E3A, U+2E3B, U+FE58, U+FE31), `curly-quotes`, `chatbot-artifacts`, `knowledge-cutoff`, `chat-residue`, `emoji-shortcode-heading`. Exceptions: quoted titles, translations, this guide.
- Low: `emoji` (skips bare ©, ®, and ™, which `\p{Extended_Pictographic}` alone would flag; misses keycaps, which `/\p{RGI_Emoji}/v` catches), `in-todays`, `staged-opener`, `summary-closer`, `double-hyphen-dash` (flags like `--json` sit in blanked code), `rhetorical-reveal`, `mic-drop`, `hedge-stack`.
- Medium: `en-dash-as-dash` (fires on rule-ID ranges between code spans; write "CC009 to CC011"), `negative-parallelism` (also fires on real contrasts such as `not just the first match but every match`), `ai-vocab` (`realm` can be literal), `marketing-words` (`empower` in IAM text), `whether-youre`, `clipped-negation`, `sign-off` (`feel free to open an issue`), `placeholder` (`.env` examples; keep them in code), `vague-attribution`, `exclamation`, `transition-stack` (act on two or more per paragraph), `bold-lead-in-bullet` (act when most items in a list match).
- High, review by hand: `context-words` (`underscore` the character, `navigate to Settings`, `unlock` a mutex, `elevated privileges`), `copula-dodge` (`acts as a proxy` is precise), `heading-title-case` (proper nouns; maintain the allowlist), `heading-colon`, `false-range` (`from source to sink` is a real scale in taint analysis), `decorative-symbols` (menu paths), `marketing-heading`, `hr-before-heading`, `absolute-claims`, `ing-tail`.
- Badge walls need a count: warn when the first 15 lines hold more than five `img.shields.io` images (a house threshold).

A read-only run over the v3 README.md, CONTRIBUTING.md, and docs/*.md reports 318 line hits. README.md has 21 lines with em dashes, 11 with emoji (the lotus in the H1 and the check-mark comparison table), 7 bold lead-in bullets, a "Why Ubon?" heading, and one en dash in a rule-ID range. docs/RULES.md has 155 lines that use an em dash as a list separator; converting that list to a table fixes them in one pass. CHANGELOG.md, run separately, has 57 lines with em dashes and 8 lines with en dashes in rule-ID ranges.

### Existing tools

- Vale (https://github.com/vale-cli/vale) runs YAML rules and skips code. Its engine is Go regexp with a regexp2 fallback, so lookarounds work; `\p{Extended_Pictographic}` is expected to fail there (untested), so use code point ranges for emoji. Useful packages: Google (sentence-case headings, exclamation points, first person, "will"; its EmDash rule only bans spaces around dashes), Microsoft, write-good, proselint, alex. CI: `vale-cli/vale-action`.
- tbhb/vale-ai-tells: 137 rules, all errors by default (EmDashUsage, OverusedVocabulary, ContrastiveFormulas, OpeningCliches, ClosingPleasantries, and more). Aggressive: FormalTransitions flags "For example", which Google's Latin rule prefers to "e.g.", and OverusedVocabulary flags "significant" and "scalable". Start it at warning level.
- jdkato/voices: anti-slop writing voices as Vale rules, from Vale's author (August 2026, early).
- markdownlint: MD001 heading increment, MD026 trailing punctuation in headings (colons included by default), MD036 emphasis as heading, MD044 proper names.
- write-good: passive voice, weasel words, weakening adverbs, "there is" openers, wordiness, clichés.
- proselint: hedging, clichés, corporate speak, jargon. Keep its typography module off, as its current default config does, because `typography.symbols.curly_quotes` recommends curly quotes.
- alex: insensitive wording. Unrelated to AI tells, but cheap.
- blader/humanizer (about 52,000 stars): an agent skill that rewrites text against a Wikipedia-derived list. Use it while writing and keep the linter as the CI gate.
- peakoss/anti-slop: a GitHub Action that scores pull requests (`max-emoji-count` defaults to 2).
- eric-sabe/slop-lint, dcadolph/slop-chop, petems/unsloppify: small and new; unvetted.

## 4. Caveats

- Word lists drift. Wikipedia's August 2026 page lists `delve`, `tapestry`, and `testament` for 2023 to mid-2024 (GPT-4), adds `fostering` and `align with` for mid-2024 to mid-2025 (GPT-4o), and keeps only `emphasizing`, `enhance`, `highlighting`, and `showcasing` from mid-2025 (GPT-5). Review the lists twice a year.
- The em dash signal is shifting. Wikipedia cites a July 2026 study in which only Claude, among current models, used em dashes more often than professional writers, and ChatGPT used them less. The study could not be located for this guide.
- Wikipedia's "Negative parallelism" article says LLMs use the construction about three times as often as humans; Its source was not checked.
- Wikipedia lists indicators that do not work: perfect grammar, mixed registers, "bland" prose, fancy words, isolated transition words, and missing citations.

## Wikipedia's categories (August 2026 snapshot)

Caveats. Content: significance, notability, superficial analyses, promotional language, vague attributions, challenges and prospects, titles treated as proper nouns. Language and grammar: AI vocabulary by era, avoiding "is" and "are", negative parallelisms (three forms), rule of three, elegant variation (false ranges appear only in the January version). Style: title case, boldface, inline-header lists, em dashes, emoji, tables, curly quotes, skipped heading levels, thematic breaks. Communication intended for the user: collaborative communication, knowledge cutoffs, placeholders. Markup: Markdown in wikitext, broken wikitext, chatbot reference markup (ChatGPT, Gemini, Grok, DeepSeek, Perplexity), invented categories and templates. Citations: dead links, invalid DOIs and ISBNs, mismatched DOIs, page-less book citations, odd reference use, `utm_source`, unused references. Also: comment indicators, edit summaries, miscellaneous, signs of human writing, ineffective indicators, historical indicators.

## Sources

wp: Wikipedia, "Signs of AI writing", https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing. Copies read: https://github.com/shreyas-makes/deslopify/blob/main/skills/deslopify/references/ai_tells.wikitext (2026-01-12) and https://github.com/mhvelplund/is-it-slop/blob/main/lib/criteria/fallback-snapshot.txt (2026-08-11). Keys use the page's January 2026 shortcuts:

- wp-vocab https://en.wikipedia.org/wiki/WP:AIVOCAB; wp-parallel https://en.wikipedia.org/wiki/WP:AIPARALLEL; wp-ro3 https://en.wikipedia.org/wiki/WP:RO3; wp-elevar https://en.wikipedia.org/wiki/WP:AIELEVAR; wp-falserange https://en.wikipedia.org/wiki/WP:FALSERANGE; wp-superficial https://en.wikipedia.org/wiki/WP:SUPERFICIAL; wp-puffery https://en.wikipedia.org/wiki/WP:AIPUFFERY; wp-weasel https://en.wikipedia.org/wiki/WP:AIWEASEL
- wp-titlecase https://en.wikipedia.org/wiki/WP:AITITLECASE; wp-bold https://en.wikipedia.org/wiki/WP:AIBOLD; wp-list https://en.wikipedia.org/wiki/WP:AILIST; wp-emoji https://en.wikipedia.org/wiki/WP:AIEMOJI; wp-dash https://en.wikipedia.org/wiki/WP:AIDASH; wp-table https://en.wikipedia.org/wiki/WP:AITABLE; wp-curly https://en.wikipedia.org/wiki/WP:AICURLY
- wp-collab https://en.wikipedia.org/wiki/WP:CERTAINLY; wp-cutoff https://en.wikipedia.org/wiki/WP:AICUTOFF; wp-markup https://en.wikipedia.org/wiki/WP:OAICITE; wp-conclusion https://en.wikipedia.org/wiki/WP:CONCLUSION; wp-citations https://en.wikipedia.org/wiki/WP:AIFICTREF
- Sections on the main page without shortcuts: wp-significance ("Undue emphasis on significance, legacy, and broader trends"), wp-copula ("Avoidance of basic copulatives"), wp-challenges ("Outline-like conclusions about challenges and future prospects"), wp-placeholder ("Phrasal templates and placeholder text"), wp-utm ("utm_source="), wp-edit-summaries ("Edit summaries"), wp-new ("Skipping heading levels", "Thematic breaks before headings"), wp-human ("Signs of human writing"), wp-ineffective ("Ineffective indicators"), wp-historical ("Historical indicators").
- wp-negpar*: https://en.wikipedia.org/wiki/Negative_parallelism

Research:

- kobak: Kobak et al., "Delving into LLM-assisted writing in biomedical publications through excess vocabulary", Science Advances 11(27), 2025. Per the abstract (extract), at least 13.5% of 2024 PubMed abstracts were LLM-processed, up to 40% in some subgroups, and the excess words are style verbs and adjectives. https://www.science.org/doi/10.1126/sciadv.adt3813. The released list, which includes seamless, comprehensive, leveraging, unlocking, elevate, enhance, realm, and pivotal: https://github.com/berenslab/llm-excess-vocab/blob/main/results/excess_words.csv
- juzek*: Juzek and Ward, "Why Does ChatGPT 'Delve' So Much?", COLING 2025. https://aclanthology.org/2025.coling-main.426/
- liang*: Liang et al., "Monitoring AI-Modified Content at Scale", ICML 2024; "commendable", "meticulous", and "intricate" rose 9.8, 34.7, and 11.2 times in ICLR 2024 reviews. https://proceedings.mlr.press/v235/liang24b.html
- reinhart*: Reinhart et al., "Do LLMs write like humans?", PNAS 2025; present participial clauses at 2 to 5 times the human rate. https://www.pnas.org/doi/10.1073/pnas.2422455122
- geng: Geng and Trotta, "Is ChatGPT Transforming Academics' Writing Style?", 2024, cited by Wikipedia for a drop of over 10% in "is" and "are" in 2023. https://arxiv.org/abs/2404.08627
- russell: Russell, Karpinska, Iyyer, "People who frequently use ChatGPT for writing tasks are accurate and robust detectors of AI-generated text", ACL 2025. https://aclanthology.org/2025.acl-long.267/
- sharma*: Sharma et al., "Towards Understanding Sycophancy in Language Models", ICLR 2024. https://arxiv.org/abs/2310.13548

Journalism and essays:

- wapo*: Merrill, Chen, Kumer, "What are the clues that ChatGPT wrote something? We analyzed its style", The Washington Post, 2025-11-13. In 328,744 gpt-4o messages, em dashes appeared in under 1 in 10 responses in mid-2024 and in over half by mid-2025; 70% of July 2025 messages had an emoji; the check mark appeared 11 times as often as in human text; "not just X, but Y" was in 6% of July chats. https://www.washingtonpost.com/technology/interactive/2025/how-detect-chatgpt-em-dash/
- kriss*: Sam Kriss, "Why Does A.I. Write Like ... That?", The New York Times Magazine, 2025-12-03. https://www.nytimes.com/2025/12/03/magazine/chatbot-writing-style.html
- gorrie*: Colin Gorrie, "Why ChatGPT writes like that", Dead Language Society, 2025-07-09. https://www.deadlanguagesociety.com/p/rhetorical-analysis-ai
- belcher*: Wendy Laura Belcher, "10 Ways AI Is Ruining Your Students' Writing", The Chronicle of Higher Education, 2025-09. https://www.chronicle.com/article/10-ways-ai-is-ruining-your-students-writing
- pangram*: Pangram Labs, "Comprehensive Guide to Spotting AI Writing Patterns". https://www.pangram.com/blog/comprehensive-guide-to-spotting-ai-writing-patterns
- openai-syc*: OpenAI, "Sycophancy in GPT-4o", 2025-04-29. https://openai.com/index/sycophancy-in-gpt-4o/
- altman*: Sam Altman on em dashes and ChatGPT custom instructions, 2025-11-14. https://x.com/sama/status/1989193813043069219

Practitioner catalogs and README evidence:

- humanizer: blader/humanizer SKILL.md v3.0.0; numbers in parentheses are its pattern numbers. https://github.com/blader/humanizer/blob/main/SKILL.md
- vat: tbhb/vale-ai-tells. https://github.com/tbhb/vale-ai-tells
- readmeai: eli64s/readme-ai prompts. The overview prompt requests a "Why [TOOL NAME]?" section and 4 to 6 bullets written as a bold emoji label, a colon, and an explanation; the tagline prompt requests "active, powerful language" in the tone of a "10x Tech Leader". https://github.com/eli64s/readme-ai/blob/main/readmeai/config/settings/prompts.toml
- nemesis: a pull request that dropped emoji from README headings because they read "as AI-generated boilerplate" (one developer's view). https://github.com/NemesisRE/dotfiles/pull/209

Good-docs references:

- google-style, google-headings, google-tone*: Google developer documentation style guide. https://developers.google.com/style/highlights, https://developers.google.com/style/headings, https://developers.google.com/style/tone. Its Vale implementation, read in full: https://github.com/vale-cli/Google
- google-md: Google's Markdown style guide, documentation best practices, and README guidance. https://google.github.io/styleguide/docguide/style.html, https://google.github.io/styleguide/docguide/best_practices.html, https://google.github.io/styleguide/docguide/READMEs.html
- ms: Microsoft Writing Style Guide, "Top 10 tips for Microsoft style and voice" ("Never Use Title Capitalization (Like This). Never Ever."). https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice
- diataxis: Daniele Procida, Diátaxis. https://diataxis.fr/
- gh-readme: GitHub Docs, "About the repository README file". https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- markdownlint: https://github.com/DavidAnson/markdownlint/tree/main/doc. Vale regex notes: https://vale.sh/docs/guides/regex
