import type { Finding, Report } from '../core/types.ts';
import { describeCounts, describeScope, location, newSuppressions } from './describe.ts';

/** Markdown for pull request comments and CI job summaries. */

export function formatMarkdown(report: Report, options: { unresolved?: Finding[] } = {}): string {
  const out: string[] = [];
  out.push(`### Ubon: ${describeCounts(report)}`);
  out.push('');
  out.push(`Checked ${describeScope(report)} with ubon ${report.tool.version}.`);
  out.push('');
  if (report.findings.length > 0) {
    out.push('| Level | Rule | Location | Finding |');
    out.push('| --- | --- | --- | --- |');
    for (const f of report.findings) {
      const existing = f.introduced === false ? ' (already at the base)' : '';
      out.push(`| ${f.level} | ${code(f.rule)} | ${code(location(f))} | ${cell(f.message)}${existing} Fix: ${cell(f.fix)} |`);
    }
    out.push('');
  }
  const added = newSuppressions(report);
  const heading = report.scope.mode === 'all' || report.scope.mode === 'paths' ? '#### Suppressions' : '#### Suppressions added in this change';
  out.push(heading);
  out.push('');
  if (added.length === 0) out.push('None.');
  else {
    out.push('| Rule | Location | Reason |');
    out.push('| --- | --- | --- |');
    for (const s of added) out.push(`| ${code(s.rule)} | ${code(location(s))} | ${cell(s.suppression.reason)} |`);
  }
  out.push('');
  if (options.unresolved && options.unresolved.length > 0) {
    out.push('#### Left unresolved by an agent');
    out.push('');
    for (const f of options.unresolved) out.push(`- ${code(f.rule)} at ${code(location(f))}: ${cell(f.message)}`);
    out.push('');
  }
  if (report.notes.length > 0 || report.notChecked.length > 0) {
    out.push('#### Not checked');
    out.push('');
    for (const n of report.notChecked) out.push(`- ${cell(n)}`);
    for (const n of report.notes) out.push(`- Note: ${cell(n)}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function code(text: string): string {
  const safe = text.replace(/\|/g, '\\|').replace(/`/g, "'");
  return `\`${safe}\``;
}
