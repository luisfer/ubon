import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import { sinksOf } from './sinks.ts';

/**
 * Request data in a command that a shell interprets (exec, execSync, spawn or
 * execa with `shell: true`, shelljs.exec, `sh -c`), or used as the program
 * name. An argument array without a shell is not a sink for the arguments.
 */
export const commandInjection: Rule = {
  meta: {
    id: 'web/command-injection',
    level: 'block',
    scope: 'file',
    title: 'Request data in a shell command',
    summary:
      'Request data in a command string run through a shell (child_process exec and execSync, spawn, execFile, or execa with shell: true, shelljs exec, sh -c), or used as the name of the program to run.',
    why: 'A shell treats characters such as ; | $() and backticks as syntax, so whoever sends the request can append their own commands and run them with the permissions of the server process.',
    fix: 'Call execFile() or spawn() with a fixed program and the value as one element of the argument array, without shell: true.',
    cwe: ['CWE-78'],
    owasp: ['A05:2025'],
    levels: 'block when request data reaches the command; warn when the value passed a schema whose constraints Ubon cannot read, and in example or template folders.',
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'command') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live, true);
        if (!hit) continue;
        if (findGuard(ctx, sink, live.filter((l) => l.taint.kind === 'request'), ['allowlist', 'regex']).cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        const what =
          sink.detail === 'program'
            ? `runs a program named by ${hit.taint.source}`
            : sink.detail === 'argv'
              ? `runs a command line built from ${hit.taint.source}`
              : `runs a shell command built from ${hit.taint.source}`;
        const schema = schemaChecked(hit.taint);
        ctx.report(sink.node, {
          message: schema
            ? `${sink.name} ${what} ${where(label, hit.taint)}, checked only by a schema whose constraints Ubon cannot read.`
            : `${sink.name} ${what} ${where(label, hit.taint)}.`,
          level: contextLevel(ctx.file, schema ? 'warn' : 'block'),
          fix:
            sink.detail === 'program'
              ? 'Choose the program from a fixed list in code and pass request data only as arguments.'
              : 'Call execFile() or spawn() with a fixed program and the value as one element of the argument array, without shell: true.',
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
