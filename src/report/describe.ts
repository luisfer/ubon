import type { Finding, Report } from '../core/types.ts';

/** Shared wording for reporters. */

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function describeScope(report: Report): string {
  const n = report.scope.files;
  switch (report.scope.mode) {
    case 'all':
      return `every file (${n})`;
    case 'paths':
      return plural(n, 'file');
    case 'staged':
      return `${plural(n, 'staged file')}`;
    case 'session':
      return `${plural(n, 'file')} changed in this session`;
    default:
      return report.scope.base ? `${plural(n, 'changed file')} since ${report.scope.base}` : plural(n, 'changed file');
  }
}

export function describeCounts(report: Report): string {
  const { block, warn } = report.summary;
  if (block === 0 && warn === 0) return 'no findings';
  const parts: string[] = [];
  if (block > 0) parts.push(`${block} blocking`);
  if (warn > 0) parts.push(plural(warn, 'warning'));
  return parts.join(', ');
}

export function location(f: Finding): string {
  return `${f.file}:${f.range.start.line}`;
}

/** Suppressions added in this change (or all of them when there is no base). */
export function newSuppressions(report: Report) {
  return report.suppressed.filter((s) => s.suppression.added !== false);
}
