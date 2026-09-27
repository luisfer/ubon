import type { Node } from '@babel/types';
import { boolValue, isCallNode, joinedToUnknown, keyName, objectProp, stringValue, unwrap } from '../../lang/js.ts';
import { isFunctionNode } from '../../lang/walk.ts';
import type { JsContext, Rule } from '../types.ts';
import { type GuardKind, OUTPUT_SINKS, contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from '../web/flow.ts';
import type { Sink, SinkCategory } from '../web/sinks.ts';
import { sinksOf } from '../web/sinks.ts';
import { isSsrfHelper } from '../web/ssrf.ts';

/**
 * Tool handlers the model can call that pass an argument chosen by the model
 * to a shell, eval, raw SQL, the file system, or fetch without constraining
 * it (OWASP LLM06, excessive agency). Enum or regex fields in the input
 * schema and allowlist checks in the handler clear the finding.
 */

const TOOL_SINKS: ReadonlySet<SinkCategory> = new Set<SinkCategory>(['command', 'code', 'sql', 'file-write', 'file-read', 'fetch']);

function action(sink: Sink): string {
  switch (sink.category) {
    case 'command':
      return sink.detail === 'program' ? 'runs a program chosen by the model' : 'runs a shell command chosen by the model';
    case 'code':
      return 'runs code chosen by the model';
    case 'sql':
      return 'runs SQL built from arguments the model chooses';
    case 'file-read':
      return 'reads a path the model chooses';
    case 'file-write':
      return /^(unlink|rm|rmdir|remove|emptyDir)(Sync)?$/.test(sink.method ?? '') ? 'deletes a path the model chooses' : 'writes to a path the model chooses';
    case 'fetch':
      return 'fetches a URL the model chooses';
    default:
      return 'uses an argument the model chooses';
  }
}

function guardsFor(category: SinkCategory): GuardKind[] {
  if (category === 'fetch') return ['host', 'allowlist', 'regex'];
  if (category === 'file-read' || category === 'file-write') return ['path-prefix', 'dotdot', 'allowlist', 'regex'];
  return ['allowlist', 'regex'];
}

interface ToolInfo {
  name: string | null;
  approval: boolean;
}

/** The tool whose handler contains the current node: its name and whether it needs human approval. */
function toolInfo(ctx: JsContext): ToolInfo {
  const parents = ctx.parents;
  for (let i = parents.length - 1; i >= 0; i--) {
    const fn = parents[i] as Node;
    if (!isFunctionNode(fn)) continue;
    const role = ctx.taint.roleOf(fn);
    if (!role) continue;
    if (role.type === 'mcp-request') return { name: null, approval: false };
    if (role.type !== 'tool') continue;
    const def = role.definition;
    if (!def) return { name: null, approval: false };
    if (def.type === 'ObjectExpression') {
      const approval = objectProp(def, 'needsApproval');
      const named = stringValue(objectProp(def, 'name')) ?? stringValue(objectProp(def, 'id'));
      return { name: named ?? nameAround(parents, def), approval: approval !== null && boolValue(approval) !== false };
    }
    if (isCallNode(def)) {
      const args = def.arguments as Node[];
      const named = stringValue(args[0]) ?? stringValue(objectProp(args[1], 'name'));
      return { name: named ?? nameAround(parents, def), approval: false };
    }
    return { name: null, approval: false };
  }
  return { name: null, approval: false };
}

/** `const runShell = tool({...})` or `tools: { runShell: tool({...}) }` */
function nameAround(parents: readonly Node[], def: Node): string | null {
  const index = parents.indexOf(def);
  for (let i = index - 1; i >= 0 && i >= index - 3; i--) {
    const p = parents[i] as Node;
    if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
    if (p.type === 'ObjectProperty') return keyName(p);
    if (p.type === 'CallExpression' && isCallNode(p)) {
      const first = unwrap(p.arguments[0] as Node);
      if (first && stringValue(first)) return stringValue(first);
    }
  }
  return null;
}

export const toolDangerousCapability: Rule = {
  meta: {
    id: 'llm/tool-dangerous-capability',
    level: 'block',
    scope: 'file',
    title: 'Tool passes model-chosen arguments to commands, code, SQL, files, or fetch',
    summary:
      'A tool handler the model can call (AI SDK tool({ execute }), OpenAI Agents tool(), MCP server tools, LangChain and Mastra tools) that passes an argument chosen by the model to a shell command, eval, raw SQL, a file write or delete, or fetch, with no enum, regex, or allowlist constraint on that argument.',
    why: "Anything the model reads (a web page, an email, a file) can tell it to call the tool with arguments of the attacker's choosing, so the tool's power becomes theirs. OWASP LLM06 (excessive agency).",
    fix: 'Constrain the argument in the input schema (z.enum() or a regex) or check it against an allowlist in the handler, and require human approval (needsApproval) for commands and file writes.',
    cwe: ['CWE-78', 'CWE-94', 'CWE-89', 'CWE-22', 'CWE-918'],
    owasp: ['LLM06:2025'],
    levels:
      'block for shell commands, code, raw SQL, file writes and deletes, and fetch; warn for file reads, for tools that require human approval (needsApproval), when the argument passed a schema whose constraints Ubon cannot read, and in example or template folders.',
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (!TOOL_SINKS.has(sink.category)) continue;
        const live = liveTaints(ctx, sink);
        if (requestTaint(live)) continue;
        if (OUTPUT_SINKS.has(sink.category) && live.some((l) => l.taint.kind === 'model' && !schemaChecked(l.taint))) continue;
        const tools = live.filter((l) => l.taint.kind === 'tool');
        const hit = tools[0];
        if (!hit) continue;
        if (findGuard(ctx, sink, tools, guardsFor(sink.category), sink.category === 'fetch' ? isSsrfHelper : undefined).cleared) continue;
        const info = toolInfo(ctx);
        const label = valueLabel(ctx, hit.value, hit.taint);
        const schema = schemaChecked(hit.taint);
        const joined = sink.category === 'fetch' && joinedToUnknown(hit.taint.prefix);
        const warn = sink.category === 'file-read' || info.approval || schema || joined;
        const tool = info.name ? `the tool ${info.name}` : 'a tool handler';
        let message = `${sink.name} in ${tool} ${action(sink)} ${where(label, hit.taint)}`;
        if (info.approval) message += ', behind a human approval step';
        else if (joined) message += ", appended directly to a base Ubon cannot read, so it can change the host unless the base ends with '/'";
        else if (schema) message += ', checked only by a schema whose constraints Ubon cannot read';
        else message += ', with no enum, regex, or allowlist constraint';
        ctx.report(sink.node, {
          message: `${message}.`,
          level: contextLevel(ctx.file, warn ? 'warn' : 'block'),
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
