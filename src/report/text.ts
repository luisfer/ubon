import { styleText } from 'node:util';
import type { Finding, Report } from '../core/types.ts';
import { describeCounts, describeScope, location, newSuppressions, plural } from './describe.ts';

/** Terminal output for people. Colors follow NO_COLOR, FORCE_COLOR, and whether stdout is a terminal. */

export interface TextOptions {
  elapsedMs?: number;
  quiet?: boolean;
  color?: boolean;
}

export function formatText(report: Report, options: TextOptions = {}): string {
  const paint = (format: Parameters<typeof styleText>[0], text: string) => (options.color === false ? text : styleText(format, text));
  const out: string[] = [];
  if (!options.quiet) {
    const time = options.elapsedMs === undefined ? '' : ` (${(options.elapsedMs / 1000).toFixed(1)} s)`;
    out.push(`ubon ${report.tool.version}: ${describeScope(report)}${time}`);
    out.push('');
  }
  const printFinding = (f: Finding) => {
    const level = f.level === 'block' ? paint(['bold', 'red'], 'block') : paint('yellow', 'warn ');
    const existing = f.introduced === false ? paint('dim', ' (already at the base)') : '';
    out.push(`${level}  ${paint('bold', f.rule)}  ${location(f)}${existing}`);
    out.push(`       ${f.message}`);
    for (const step of f.trace ?? []) out.push(`       ${paint('dim', String(step.line).padEnd(4))}${step.note}`);
    if (!f.trace && f.evidence) out.push(`       ${paint('dim', String(f.range.start.line).padEnd(4))}${f.evidence}`);
    out.push(`       Fix: ${f.fix}`);
    out.push('');
  };
  report.findings.forEach(printFinding);

  const added = newSuppressions(report);
  if (added.length > 0 && !options.quiet) {
    out.push(paint('bold', report.scope.mode === 'all' || report.scope.mode === 'paths' ? 'Suppressed:' : 'Suppressions added in this change:'));
    for (const s of added) out.push(`  ${s.rule}  ${location(s)}  ${s.suppression.reason}`);
    out.push('');
  }

  if (!options.quiet) {
    let summary = `${capitalize(describeCounts(report))}.`;
    if (report.summary.suppressed > 0) summary += ` ${plural(report.summary.suppressed, 'finding')} suppressed.`;
    if (report.summary.baselined > 0) summary += ` ${plural(report.summary.baselined, 'finding')} in the baseline.`;
    out.push(summary);
    for (const note of report.notes) out.push(`Note: ${note}.`);
    if (report.notChecked.length > 0) out.push(`Not checked: ${report.notChecked.join('; ')}.`);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return `${out.join('\n')}\n`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
