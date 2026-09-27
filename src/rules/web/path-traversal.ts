import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import type { Sink } from './sinks.ts';
import { sinksOf } from './sinks.ts';

/**
 * File system calls whose path comes from the request. path.basename() clears
 * the finding, and so does resolving the path and checking that it starts
 * with the allowed directory.
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
    levels: 'block when request data reaches the path; warn when the value passed a schema whose constraints Ubon cannot read, and in example or template folders.',
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'file-read' && sink.category !== 'file-write') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live, true);
        if (!hit) continue;
        if (findGuard(ctx, sink, live.filter((l) => l.taint.kind === 'request'), ['path-prefix', 'dotdot', 'allowlist', 'regex']).cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        const schema = schemaChecked(hit.taint);
        const text = `${sink.name} ${verb(sink)} a path built from ${hit.taint.source} ${where(label, hit.taint)}`;
        ctx.report(sink.node, {
          message: schema ? `${text}, checked only by a schema whose constraints Ubon cannot read.` : `${text}.`,
          level: contextLevel(ctx.file, schema ? 'warn' : 'block'),
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
