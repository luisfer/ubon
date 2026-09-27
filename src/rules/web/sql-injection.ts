import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import { sinksOf } from './sinks.ts';

/**
 * Request data in the SQL text of a raw query API. Tagged templates that
 * parameterize (Drizzle, postgres.js, @vercel/postgres `sql`, Prisma
 * `$queryRaw`) are never sinks: the interpolated values travel as parameters.
 */
export const sqlInjection: Rule = {
  meta: {
    id: 'web/sql-injection',
    level: 'block',
    scope: 'file',
    title: 'Request data in raw SQL',
    summary:
      'Request data concatenated or interpolated into the SQL text of a raw query API: Prisma $queryRawUnsafe and $executeRawUnsafe, Drizzle sql.raw(), postgres.js sql.unsafe(), Knex raw(), pg and mysql2 query() and execute(), better-sqlite3 prepare() and exec(), Sequelize query() and literal().',
    why: 'Whoever sends the request can rewrite the statement and read or change data the query was never meant to touch. Tagged templates such as Drizzle sql`...` and Prisma $queryRaw`...` send values separately from the SQL text, which is why they are safe.',
    fix: 'Pass the value as a query parameter (a tagged sql`...` template, $queryRaw`...`, or a placeholder with a values array) instead of building the SQL string.',
    cwe: ['CWE-89'],
    owasp: ['A05:2025'],
    levels: 'block when request data reaches the SQL text; warn when the value passed a schema whose constraints Ubon cannot read, and in example or template folders.',
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'sql') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live);
        if (!hit) continue;
        const requests = live.filter((l) => l.taint.kind === 'request');
        if (findGuard(ctx, sink, requests, ['allowlist', 'regex']).cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        const schema = schemaChecked(hit.taint);
        ctx.report(sink.node, {
          message: schema
            ? `${sink.name} runs SQL built from ${hit.taint.source} ${where(label, hit.taint)}, checked only by a schema whose constraints Ubon cannot read.`
            : `${sink.name} runs SQL built from ${hit.taint.source} ${where(label, hit.taint)}.`,
          level: contextLevel(ctx.file, schema ? 'warn' : 'block'),
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
