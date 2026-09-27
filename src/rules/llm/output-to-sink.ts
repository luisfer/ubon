import type { Node } from '@babel/types';
import type { Taint } from '../../lang/js.ts';
import type { Rule } from '../types.ts';
import { OUTPUT_SINKS, contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from '../web/flow.ts';
import type { Sink } from '../web/sinks.ts';
import { sinksOf } from '../web/sinks.ts';
import { htmlDirectives } from '../web/templates.ts';
import { isSafeHtmlCall } from '../web/xss-html-sink.ts';

/**
 * Model output reaching code execution, a shell, raw SQL, or an HTML sink
 * (OWASP LLM05). Request data at the same sink is reported by the web pack
 * instead, so a sink is reported once.
 */

function action(sink: Sink): string {
  switch (sink.category) {
    case 'sql':
      return 'runs SQL built from model output';
    case 'command':
      return sink.detail === 'program' ? 'runs a program named by model output' : 'runs a shell command built from model output';
    case 'html':
      return 'renders model output as HTML';
    default:
      if (sink.detail === 'import' || sink.detail === 'require') return 'loads a module named by model output';
      if (sink.detail === 'template') return 'compiles model output as a template';
      return 'runs model output as code';
  }
}

function modelTaint(taints: Taint[]): Taint | undefined {
  return taints.find((t) => t.kind === 'model' && !schemaChecked(t));
}

export const outputToSink: Rule = {
  meta: {
    id: 'llm/output-to-sink',
    level: 'block',
    scope: 'file',
    title: 'Model output used as code, SQL, a command, or HTML',
    summary:
      'Output of a language model call (generateText().text, result.object, choices[0].message.content, content[0].text, streamed text, useChat messages) reaching eval, new Function, child_process, raw SQL, or an HTML sink without a sanitizer or schema check.',
    why: 'Models follow instructions hidden in the text they read (prompt injection), so executing their output or rendering it as HTML gives whoever wrote that text control of the server or the page. OWASP LLM05 (improper output handling).',
    fix: 'Treat model output as untrusted input: map it to fixed values with a schema or an allowlist, sanitize HTML with DOMPurify, and never pass it to eval, a shell, or raw SQL.',
    cwe: ['CWE-94', 'CWE-78', 'CWE-89', 'CWE-79'],
    owasp: ['LLM05:2025'],
    levels: 'block; warn in example or template folders. A schema parse or a sanitizer on the value clears it.',
  },
  appliesTo: isCheckedCode,
  text(ctx) {
    const lang = ctx.file.lang;
    if (lang !== 'vue' && lang !== 'svelte' && lang !== 'astro') return;
    for (const d of htmlDirectives(ctx.text, lang, isSafeHtmlCall, { path: ctx.file.path, read: (p) => ctx.project.read(p) })) {
      if (d.constant || d.safe) continue;
      const live = d.taints.filter((t) => !t.via.includes('html-sanitizer') && !t.via.includes('number'));
      if (live.some((t) => t.kind === 'request')) continue;
      const hit = modelTaint(live);
      if (!hit) continue;
      const label = d.expression.length > 40 ? `${d.expression.slice(0, 37)}...` : d.expression;
      ctx.report({
        line: d.line,
        column: d.column,
        endColumn: d.endColumn,
        message: `${d.kind} renders model output as HTML (${label}, line ${hit.line}).`,
        level: contextLevel(ctx.file, 'block'),
        trace: [
          { line: hit.line, note: `${label} comes from model output` },
          { line: d.line, note: `reaches ${d.kind}` },
        ],
        key: label,
      });
    }
  },
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (!OUTPUT_SINKS.has(sink.category)) continue;
        const live = liveTaints(ctx, sink);
        if (requestTaint(live)) continue;
        const models = live.filter((l) => l.taint.kind === 'model' && !schemaChecked(l.taint));
        const hit = models[0];
        if (!hit) continue;
        if (sink.category !== 'html' && findGuard(ctx, sink, models, ['allowlist', 'regex']).cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        ctx.report(sink.node, {
          message: `${sink.name} ${action(sink)} ${where(label, hit.taint)}.`,
          level: contextLevel(ctx.file, 'block'),
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
