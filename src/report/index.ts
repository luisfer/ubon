import type { Report } from '../core/types.ts';
import { formatAgent } from './agent.ts';
import { formatMarkdown } from './markdown.ts';
import { formatSarif } from './sarif.ts';
import { formatText } from './text.ts';

export type Format = 'text' | 'agent' | 'json' | 'sarif' | 'markdown';
export const FORMATS: readonly Format[] = ['text', 'agent', 'json', 'sarif', 'markdown'];

export function formatReport(report: Report, format: Format, options: { elapsedMs?: number; quiet?: boolean; color?: boolean } = {}): string {
  switch (format) {
    case 'agent':
      return formatAgent(report);
    case 'json':
      return `${JSON.stringify(report, null, 2)}\n`;
    case 'sarif':
      return formatSarif(report);
    case 'markdown':
      return formatMarkdown(report);
    default:
      return formatText(report, options);
  }
}

export { formatAgent, formatMarkdown, formatSarif, formatText };
