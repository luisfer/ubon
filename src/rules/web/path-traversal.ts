import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { contextLevel, findGuard, findLookup, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import type { Sink } from './sinks.ts';
import { sinksOf } from './sinks.ts';

/**
 * File system calls whose path comes from the request. path.basename() clears
 * the finding, and so does resolving the path and checking that it starts
 * with the allowed directory. A lookup of the value that the code must pass
 * first (`if (!(await findChallenge(key))) return`) lowers the finding to
 * warn: the lookup admits only the values it knows, which Ubon cannot read.
 */

function verb(sink: Sink): string {
  if (sink.category === 'file-read') return 'opens';
  const method = sink.method ?? '';
  if (/^(unlink|rm|rmdir|remove|emptyDir)(Sync)?$/.test(method)) return 'deletes';
  if (/^(rename|copyFile|cp|copy|move|link|symlink)(Sync)?$/.test(method)) return 'copies or moves';
  if (/^(mkdir|mkdirp|mkdirs|ensureDir|ensureFile)(Sync)?$/.test(method)) return 'creates';
  return 'writes to';
}

export const pathTraversal: Rule = {
  meta: {
    id: 'web/path-traversal',
    level: 'block',
    scope: 'file',
    title: 'Request data in a file path',
    summary: 'fs reads, writes, and deletes, createReadStream, res.sendFile, res.download, Bun.file, and Bun.write with a path built from request data.',
    why: 'A path segment such as ../../ or an absolute path lets whoever sends the request read or overwrite files outside the directory the code meant to use, such as .env files, keys, or source code.',
    fix: 'Reduce the value to a file name with path.basename(), or resolve it with path.resolve(root, value) and reject it unless it starts with root plus path.sep.',
    cwe: ['CWE-22'],
    owasp: ['A01:2025'],
    levels:
      'block when request data reaches the path; warn when the value passed a schema whose constraints Ubon cannot read, when the code first looks the value up and goes on only if the lookup finds it (Ubon cannot read which values the lookup accepts), and in example or template folders.',
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'file-read' && sink.category !== 'file-write') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live, true);
        if (!hit) continue;
        const request = live.filter((l) => l.taint.kind === 'request');
        if (findGuard(ctx, sink, request, ['path-prefix', 'dotdot', 'allowlist', 'regex']).cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        const schema = schemaChecked(hit.taint);
        const lookup = schema ? undefined : findLookup(ctx, sink, request);
        const text = `${sink.name} ${verb(sink)} a path built from ${hit.taint.source} ${where(label, hit.taint)}`;
        const trace = traceOf(label, hit.taint, sink);
        if (lookup) trace.splice(1, 0, { line: lookup.line, note: `${label} is looked up with ${lookup.name}` });
        ctx.report(sink.node, {
          message: schema
            ? `${text}, checked only by a schema whose constraints Ubon cannot read.`
            : lookup
              ? `${text}, checked only by a lookup Ubon cannot read (${lookup.name}, line ${lookup.line}).`
              : `${text}.`,
          level: contextLevel(ctx.file, schema || lookup ? 'warn' : 'block'),
          trace,
          key: label,
        });
      }
    });
  },
};
