/**
 * Programmatic API. Stable across minor versions:
 *
 *   import { check } from 'ubon'
 *   const report = await check({ cwd: '/path/to/repo', mode: 'diff', base: 'origin/main' })
 *
 * Rules, adapters, and everything not exported here are internal.
 */

export { check } from './core/engine.ts';
export type { CheckOptions } from './core/engine.ts';
export type { Finding, Level, Report, ReportScope, ScopeMode, SuppressedFinding, TraceStep } from './core/types.ts';
export { formatReport, FORMATS } from './report/index.ts';
export type { Format } from './report/index.ts';
export { VERSION as version } from './version.ts';

import { RULES } from './rules/index.ts';
import { docsUrl } from './rules/types.ts';

/** Metadata for every rule: id, level, scope, title, summary, why, fix, references. */
export function rules() {
  return RULES.map((r) => ({ ...r.meta, docs: docsUrl(r.meta.id) }));
}
