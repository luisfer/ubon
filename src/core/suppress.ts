import type { Lang } from './files.ts';
import { commentStyleFor, findComments } from '../lang/comments.ts';

/**
 * Inline suppressions:
 *
 *   // ubon-ignore web/ssrf: luisfer: URL is checked by isAllowedHost() in lib/net.ts
 *
 * The comment goes at the end of the line or on its own line above. It names
 * one or more rule IDs and a reason in the form `<who decided>: <evidence>`.
 * A suppression without a reason, or with an unknown rule, suppresses nothing
 * and is reported by integrity/invalid-suppression.
 */

export interface Suppression {
  /** Line of the comment (1-based). */
  line: number;
  /** Lines the suppression applies to. */
  targets: number[];
  rules: string[];
  who: string;
  evidence: string;
  /** `who: evidence`, as written. */
  reason: string;
  valid: boolean;
  problem?: string;
}

const RULE_ID = /^[a-z][a-z0-9]*\/[a-z0-9][a-z0-9-]*$/;

/**
 * Suppressions are real comments whose text starts with `ubon-ignore`. The
 * syntax inside strings, and inside documentation that explains it, is not a
 * suppression. Markdown files use HTML comments.
 */
export function parseSuppressions(text: string, lines: readonly string[], lang: Lang, path: string, knownRules: ReadonlySet<string>): Suppression[] {
  if (!text.includes('ubon-ignore')) return [];
  const out: Suppression[] = [];
  for (const span of findComments(text, commentStyleFor(lang, path))) {
    const body = span.body.replace(/^[\s*]+/, '');
    if (!body.startsWith('ubon-ignore')) continue;
    const rest = body.slice('ubon-ignore'.length);
    if (rest.length > 0 && !/^[\s:]/.test(rest)) continue; // ubon-ignored, ubon-ignore-file, ...
    const firstLine = (rest.split('\n')[0] ?? '').replace(/\s*(\*\/\s*\}?|-->)\s*$/, '').trim();
    const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
    const before = text.slice(lineStart, span.start).trim();
    const ownLine = before === '' || before === '{';
    const targets = ownLine ? [span.line, nextCodeLine(lines, span.line - 1)] : [span.line];
    out.push({ line: span.line, targets: targets.filter((t) => t > 0), ...parseBody(firstLine, knownRules) });
  }
  return out;
}

function nextCodeLine(lines: readonly string[], index: number): number {
  for (let j = index + 1; j < lines.length; j++) {
    const t = (lines[j] as string).trim();
    if (t === '') continue;
    // Stacked suppressions: skip other comment lines that are suppressions.
    if (/^(\/\/|\/\*|#|--|<!--|\{\s*\/\*)\s*ubon-ignore\b/.test(t)) continue;
    return j + 1;
  }
  return -1;
}

function parseBody(body: string, knownRules: ReadonlySet<string>): Omit<Suppression, 'line' | 'targets'> {
  // "<rules>: <who>: <evidence>"
  const colon = body.indexOf(':');
  const ruleText = (colon === -1 ? body : body.slice(0, colon)).trim();
  const rules = ruleText
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
  const rest = colon === -1 ? '' : body.slice(colon + 1).trim();
  const second = rest.indexOf(':');
  const who = second === -1 ? '' : rest.slice(0, second).trim();
  const evidence = second === -1 ? rest : rest.slice(second + 1).trim();
  const base = { rules, who, evidence, reason: rest };
  if (rules.length === 0) return { ...base, valid: false, problem: 'names no rule' };
  const unknown = rules.filter((r) => !RULE_ID.test(r) || !knownRules.has(r));
  if (unknown.length > 0) return { ...base, valid: false, problem: `names an unknown rule: ${unknown.join(', ')}` };
  if (!who || !evidence) return { ...base, valid: false, problem: 'has no reason in the form "<who decided>: <evidence>"' };
  if (who.length > 80) return { ...base, valid: false, problem: 'has a "who" part longer than 80 characters' };
  return { ...base, valid: true };
}

/** Find the valid suppression covering a finding, if any. */
export function findSuppression(suppressions: readonly Suppression[], rule: string, line: number): Suppression | undefined {
  return suppressions.find((s) => s.valid && s.rules.includes(rule) && s.targets.includes(line));
}
