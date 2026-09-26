import type { Finding, Report } from '../core/types.ts';
import { describeCounts, describeScope, location, newSuppressions } from './describe.ts';

/**
 * Output for coding agents: the same facts as the text format in fewer tokens,
 * one finding per line, and the instructions an agent needs at the end.
 */

export const AGENT_INSTRUCTIONS =
  'Fix BLOCK findings before you finish. If one is wrong, add `// ubon-ignore <rule>: <who decided>: <evidence>` above the line (use the comment syntax of the file) and tell the user. Do not edit ubon.json or hook settings to get past a finding.';

export function formatFindingLine(f: Finding): string {
  const level = f.level === 'block' ? 'BLOCK' : 'WARN';
  const trace = f.trace && f.trace.length > 0 ? ` (${f.trace.map((s) => `line ${s.line}: ${s.note}`).join('; ')})` : '';
  const existing = f.introduced === false ? ' [already at the base]' : '';
  const message = f.message.replace(/\.$/, '');
  return `${level} ${f.rule} ${location(f)}${existing} ${message}${trace}. Fix: ${f.fix}`;
}

export function formatAgent(report: Report, options: { instructions?: boolean; maxFindings?: number } = {}): string {
  const out: string[] = [];
  const base = report.scope.mode === 'diff' && report.scope.base ? ` (base ${report.scope.base})` : '';
  const scope = describeScope(report).replace(/ since .*$/, '');
  out.push(`ubon: ${describeCounts(report)} in ${scope}${base}`);
  const max = options.maxFindings ?? 50;
  const blocking = report.findings.filter((f) => f.level === 'block');
  const warnings = report.findings.filter((f) => f.level === 'warn');
  const shown = [...blocking, ...warnings].slice(0, max);
  for (const f of shown) out.push(formatFindingLine(f));
  if (report.findings.length > shown.length) out.push(`... ${report.findings.length - shown.length} more; run \`ubon check --format json\` for all of them.`);
  const added = newSuppressions(report);
  if (added.length > 0) out.push(`Suppressed: ${added.map((s) => `${s.rule} ${location(s)} (${s.suppression.reason})`).join('; ')}`);
  for (const note of report.notes) out.push(`Note: ${note}.`);
  if (report.notChecked.length > 0) out.push(`Not checked: ${report.notChecked.join('; ')}.`);
  if (blocking.length > 0 && options.instructions !== false) out.push(AGENT_INSTRUCTIONS);
  return `${out.join('\n')}\n`;
}
