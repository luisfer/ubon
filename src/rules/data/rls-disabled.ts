import { formatName } from '../../lang/sql.ts';
import type { Rule } from '../types.ts';
import { type Loc, dirStanding, findSupabaseDirs, historyFor, touchesSupabaseSql } from './supabase-sql.ts';

/**
 * Tables in a schema the Supabase Data API exposes, left without row level
 * security at the end of the migration history. Reported at the create table
 * statement (every one, when declarative schemas repeat it), or at the
 * statement that disables row level security, so that in diff mode a new
 * migration is reported and old debt in unchanged files is not.
 */

export const rlsDisabled: Rule = {
  meta: {
    id: 'data/rls-disabled',
    level: 'block',
    scope: 'project',
    title: 'Supabase table without row level security',
    summary:
      'A table in a schema exposed by the Supabase Data API (public, plus the schemas in supabase/config.toml) that no migration or declarative schema gives row level security, or whose row level security is disabled.',
    why: 'Supabase grants the anon and authenticated roles access to tables in exposed schemas. Without row level security, anyone with the project URL and the anon key, which ships in every client bundle, can read and change every row.',
    fix: 'Enable row level security on the table in the same migration (`alter table <name> enable row level security;`) and add policies for the access each role needs.',
    cwe: ['CWE-284', 'CWE-862'],
    owasp: ['A01:2025'],
    levels:
      'block for tables; warn for views created without security_invoker, materialized views, and partitions (which do not inherit row level security from their parent); warn for everything under example and template folders. Tables whose privileges are revoked from both anon and authenticated are not reported.',
  },
  project(ctx) {
    if (!touchesSupabaseSql(ctx)) return;
    for (const dir of findSupabaseDirs(ctx.project)) {
      const standing = dirStanding(dir);
      if (standing === 'skip') continue;
      const history = historyFor(ctx, dir);
      const report = (loc: Loc, level: 'block' | 'warn', message: string, fix: string, key: string) => {
        if (ctx.info(loc.file).generated) return;
        ctx.report(loc.file, { line: loc.line, level: standing === 'example' ? 'warn' : level, message, fix, key });
      };
      for (const rel of history.relations) {
        if (!history.exposed.has(rel.schema)) continue;
        if (rel.revoked.has('anon') && rel.revoked.has('authenticated')) continue;
        const name = formatName({ schema: rel.schema, name: rel.name });
        if (rel.kind === 'view') {
          if (rel.invoker) continue;
          const at = rel.invokerLostAt ?? rel.movedAt ?? (rel.creates[rel.creates.length - 1] as Loc);
          report(
            at,
            'warn',
            `View ${name} runs with its owner's rights (no security_invoker), so it bypasses row level security on the tables it reads and anyone with the anon key can query it.`,
            `Create the view with (security_invoker = true), or revoke select on ${name} from anon and authenticated.`,
            name,
          );
          continue;
        }
        if (rel.kind === 'materialized view') {
          const at = rel.movedAt ?? (rel.creates[rel.creates.length - 1] as Loc);
          report(
            at,
            'warn',
            `Materialized view ${name} is in an exposed schema, and materialized views cannot have row level security, so anyone with the anon key can read all of it through the Data API.`,
            `Move ${name} to a schema the Data API does not expose, or revoke select on it from anon and authenticated.`,
            name,
          );
          continue;
        }
        if (rel.rls === 'enabled') continue;
        const enableFix = `Enable row level security on the table (alter table ${name} enable row level security;) and add policies for the access each role needs.`;
        if (rel.rls === 'disabled' && rel.disabledAt) {
          report(
            rel.disabledAt,
            rel.partitionOf ? 'warn' : 'block',
            `This statement disables row level security on ${name}, so anyone with the anon key can read and change every row through the Data API.`,
            `Remove the disable statement and write policies that allow what the app needs.`,
            name,
          );
          continue;
        }
        if (history.dynamicRlsFunction) continue; // a function may enable it at run time
        const places = rel.movedAt ? [rel.movedAt] : rel.creates;
        for (const at of places) {
          if (rel.partitionOf) {
            report(
              at,
              'warn',
              `Partition ${name} of ${rel.partitionOf} has no row level security of its own; partitions do not inherit it, so queries that name the partition skip the parent's policies.`,
              `Enable row level security on the partition (alter table ${name} enable row level security;) and add the parent's policies.`,
              name,
            );
          } else {
            report(
              at,
              'block',
              rel.movedAt
                ? `This statement moves ${name} into an exposed schema without row level security, so anyone with the anon key can read and change every row through the Data API.`
                : `Table ${name} is created without row level security and no later statement enables it, so anyone with the anon key can read and change every row through the Data API.`,
              enableFix,
              name,
            );
          }
        }
      }
    }
  },
};
