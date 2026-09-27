import { splitLines } from '../../core/diff.ts';
import { languageOf } from '../../core/files.ts';
import { type Suppression, parseSuppressions } from '../../core/suppress.ts';
import { isRecord, parseStructured } from '../../lang/structured.ts';
import { ruleIds } from '../index.ts';
import type { DiffContext, Rule } from '../types.ts';
import { type Occurrence, changesOf, newOccurrences, normalizeWhitespace, plural, prepareRun, snippet } from './shared.ts';

/**
 * Every suppression added in the change is listed: new `ubon-ignore`
 * comments and new entries in `.ubon/baseline.json`. A suppression is a claim
 * that a finding is wrong or accepted; listing each one means a suppression
 * written by an agent is never silent. With `"suppressions": { "agent":
 * "human-only" }` in ubon.json, suppressions added during an agent session
 * block until a person approves them.
 */

const BASELINE = '.ubon/baseline.json';
const MAX_BASELINE_FINDINGS = 25;

interface NewComment extends Occurrence {
  sup: Suppression;
}

function levelFor(ctx: DiffContext): 'block' | 'warn' {
  return ctx.session && ctx.config.suppressions.agent === 'human-only' ? 'block' : 'warn';
}

function fixFor(ctx: DiffContext, what: string): string {
  return levelFor(ctx) === 'block'
    ? `Ask the user to review this ${what}; this project only accepts suppressions that a person approves.`
    : `Check that the reason is true and remove the ${what} if the finding is real.`;
}

function comments(ctx: DiffContext): void {
  const after = ctx.after;
  if (after === null || !after.includes('ubon-ignore')) return;
  const changes = changesOf(ctx);
  if (changes.added.length === 0 || !changes.added.some((l) => l.text.includes('ubon-ignore'))) return;
  const known = ruleIds();
  const lang = languageOf(ctx.file.path);
  const toOccurrences = (text: string): NewComment[] =>
    parseSuppressions(text, splitLines(text), lang, ctx.file.path, known)
      .filter((s) => s.valid)
      .map((s) => ({ line: s.line, sig: `${[...s.rules].sort().join(',')}|${normalizeWhitespace(s.reason)}`, sup: s }));
  const now = toOccurrences(after);
  if (now.length === 0) return;
  const before = changes.before === null || !changes.before.includes('ubon-ignore') ? [] : toOccurrences(changes.before);
  for (const { sup, sig } of newOccurrences(now, before, changes.addedLines)) {
    const rules = sup.rules.join(', ');
    ctx.report({
      line: sup.line,
      level: levelFor(ctx),
      message: `New suppression of ${rules} with the reason "${snippet(sup.reason, 140)}".`,
      fix: fixFor(ctx, 'suppression'),
      key: sig,
    });
  }
}

interface Entry {
  rule: string;
  file: string;
  fingerprint: string;
}

function entriesOf(text: string | null): { entries: Entry[]; lineOf: (i: number) => number } | null {
  if (text === null) return { entries: [], lineOf: () => 1 };
  const doc = parseStructured(text, 'json');
  if (!isRecord(doc.data) || !Array.isArray(doc.data.findings)) return null;
  const entries = doc.data.findings.filter(
    (e): e is Entry => isRecord(e) && typeof e.rule === 'string' && typeof e.file === 'string' && typeof e.fingerprint === 'string',
  );
  return { entries, lineOf: (i) => doc.lineOf(['findings', i]) ?? 1 };
}

function baselineEntries(ctx: DiffContext): void {
  const after = entriesOf(ctx.after);
  const changes = changesOf(ctx);
  const before = entriesOf(changes.before);
  if (!after || !before) return;
  const key = (e: Entry) => `${e.rule}\0${e.file}\0${e.fingerprint}`;
  const had = new Set(before.entries.map(key));
  const added = after.entries.map((e, i) => ({ e, i })).filter(({ e }) => !had.has(key(e)));
  added.slice(0, MAX_BASELINE_FINDINGS).forEach(({ e, i }) => {
    ctx.report({
      line: after.lineOf(i),
      level: levelFor(ctx),
      message: `New baseline entry hides a ${e.rule} finding in ${e.file}; baseline entries carry no reason.`,
      fix: fixFor(ctx, 'baseline entry'),
      key: key(e),
    });
  });
  const rest = added.slice(MAX_BASELINE_FINDINGS);
  if (rest.length > 0) {
    const byRule = new Map<string, number>();
    for (const { e } of rest) byRule.set(e.rule, (byRule.get(e.rule) ?? 0) + 1);
    const summary = [...byRule.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 6)
      .map(([rule, n]) => `${rule}: ${n}`)
      .join(', ');
    ctx.report({
      line: after.lineOf((rest[0] as { i: number }).i),
      level: levelFor(ctx),
      message: `${plural(rest.length, 'more new baseline entry', 'more new baseline entries')} hide findings (${summary}${byRule.size > 6 ? ', ...' : ''}).`,
      fix: fixFor(ctx, 'baseline change'),
      key: 'baseline-rest',
    });
  }
}

export const newSuppression: Rule = {
  meta: {
    id: 'integrity/new-suppression',
    level: 'warn',
    scope: 'diff',
    title: 'Suppression added in the change',
    summary: 'A new `ubon-ignore` comment or a new entry in `.ubon/baseline.json`. Every one is listed with the rule it suppresses and the reason given.',
    why: 'A suppression turns a finding off on the word of whoever wrote it. Listing each new one keeps a suppression written by an agent visible to the person who reviews the change.',
    fix: 'Check that the reason is true and remove the suppression if the finding is real.',
    levels: 'warn by default; block when ubon.json sets `"suppressions": { "agent": "human-only" }` and the check runs for an agent session.',
  },
  appliesTo: (file) => !file.generated || file.path === BASELINE,
  project: prepareRun,
  diff(ctx) {
    if (ctx.after === null) return;
    if (ctx.file.path === BASELINE) baselineEntries(ctx);
    else comments(ctx);
  },
};
