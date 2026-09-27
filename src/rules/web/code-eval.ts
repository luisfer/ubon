import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { anyTaint, contextLevel, findGuard, isCheckedCode, isConstantValue, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import type { Sink } from './sinks.ts';
import { sinksOf } from './sinks.ts';

/**
 * Code built from request data: eval, new Function, vm, string timers,
 * dynamic import() and require(), and template engines that compile to code.
 * Model output and tool arguments at the same sinks belong to the llm pack.
 */

function action(sink: Sink, source: string): string {
  switch (sink.detail) {
    case 'import':
    case 'require':
      return `loads a module named by ${source}`;
    case 'timer':
      return `runs a string from ${source} as code`;
    case 'template':
      return `compiles a template from ${source} into code`;
    case 'function':
      return `compiles code from ${source}`;
    default:
      return `runs code from ${source}`;
  }
}

export const codeEval: Rule = {
  meta: {
    id: 'web/code-eval',
    level: 'block',
    scope: 'file',
    title: 'Request data evaluated as code',
    summary:
      'eval, new Function, vm.runIn*Context and vm.Script, setTimeout or setInterval with a string, dynamic import() or require(), and template compilers (lodash template, ejs, pug) with request data; eval, Function, and vm with any value that is not a constant.',
    why: 'Evaluated strings run with every permission of the page or the server process, so request data there lets whoever sends it run their own code.',
    fix: 'Parse data instead of evaluating it (JSON.parse, a schema), and choose modules and templates from a fixed map in code.',
    cwe: ['CWE-95'],
    owasp: ['A05:2025'],
    levels:
      'block when request data reaches the code; warn for eval, Function, and vm with a value of unknown origin that is not a constant, when the value passed a schema whose constraints Ubon cannot read, and in example or template folders. Dynamic import() of unknown origin is not reported (code splitting uses it).',
  },
  appliesTo: (file) => isCheckedCode(file) && !file.contexts.has('config'),
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'code') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live);
        if (hit) {
          if (findGuard(ctx, sink, live.filter((l) => l.taint.kind === 'request'), ['allowlist', 'regex']).cleared) continue;
          const label = valueLabel(ctx, hit.value, hit.taint);
          const schema = schemaChecked(hit.taint);
          const text = `${sink.name} ${action(sink, hit.taint.source)} ${where(label, hit.taint)}`;
          ctx.report(sink.node, {
            message: schema ? `${text}, checked only by a schema whose constraints Ubon cannot read.` : `${text}.`,
            level: contextLevel(ctx.file, schema ? 'warn' : 'block'),
            fix:
              sink.detail === 'import' || sink.detail === 'require'
                ? 'Map the request value to a module through a fixed object of allowed imports instead of passing it to import() or require().'
                : undefined,
            trace: traceOf(label, hit.taint, sink),
            key: label,
          });
          continue;
        }
        // Model output and tool arguments are reported by the llm pack.
        if (live.length > 0) continue;
        if (sink.detail !== 'eval' && sink.detail !== 'function' && sink.detail !== 'vm') continue;
        if (anyTaint(ctx, sink)) continue;
        if (sink.values.every((v) => isConstantValue(ctx, v))) continue;
        const label = valueLabel(ctx, sink.values[sink.values.length - 1] as Node);
        ctx.report(sink.node, {
          message: `${sink.name} runs a string that is not a constant (${label}).`,
          level: 'warn',
          key: label,
        });
      }
    });
  },
};
