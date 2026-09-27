import type { Node, ObjectExpression } from '@babel/types';
import { isCallNode, lineOf, memberPath, objectProp, stringValue, unwrap } from '../../lang/js.ts';
import type { JsContext, Rule } from '../types.ts';
import { isCheckedCode, shorten, valueLabel } from '../web/flow.ts';

/**
 * Request data or fetched content in the system position of a model call:
 * the `system` option (AI SDK, Anthropic), `instructions` (OpenAI Responses
 * and Agents, AI SDK agents), `systemInstruction` (Gemini), and messages with
 * role 'system' or 'developer'. User input in user messages is how chat works
 * and is never reported.
 */

const SYSTEM_KEYS = ['system', 'instructions', 'systemInstruction', 'system_instruction', 'additional_instructions', 'systemPrompt'];

/** Calls and constructors whose options carry a system prompt. */
function systemCarrier(ctx: JsContext, call: Node): string | null {
  const callee = (call as { callee?: Node }).callee;
  if (!callee) return null;
  const canonical = ctx.imports.canonical(callee) ?? '';
  // Name the call as it is written in the code.
  const written = shorten(memberPath(callee) ?? canonical.replace(/^.*#/, ''), 40);
  if (call.type !== 'NewExpression' && ctx.taint.isModelCall(call)) return `${written}()`;
  if (call.type === 'NewExpression' && /(^|[.#])(Agent|ToolLoopAgent|Experimental_Agent|RealtimeAgent)$/.test(canonical) && ctx.imports.importsModule(/^(ai|@openai\/agents|@openai\/agents-[\w-]+|@mastra\/core|@mastra\/core\/agent)$/)) {
    return `new ${written}()`;
  }
  if (/(^|[.#])Agent\.create$/.test(canonical)) return `${written}()`;
  if (/(^|\.)assistants\.(create|update)$|(^|\.)runs\.(create|createAndPoll|stream|createAndStream)$/.test(canonical)) return `${written}()`;
  if (/(^|\.)getGenerativeModel$/.test(canonical)) return `${written}()`;
  return null;
}

export const untrustedSystemPrompt: Rule = {
  meta: {
    id: 'llm/untrusted-system-prompt',
    level: 'warn',
    scope: 'file',
    title: 'Request or fetched text in a system prompt',
    summary:
      'Request data or the body of a network response interpolated into a system prompt: the system option of AI SDK and Anthropic calls, instructions in the OpenAI Responses and Agents APIs, Gemini systemInstruction, or a message with role system or developer.',
    why: 'Models give the system prompt more authority than user messages, so text placed there by whoever sends the request, or by whoever controls a fetched page, can override the instructions that keep the model on task. OWASP LLM01 (prompt injection).',
    fix: 'Keep the system prompt fixed in code, and pass request or fetched text in a user message, marked as data (for example inside <document> tags).',
    cwe: ['CWE-1427'],
    owasp: ['LLM01:2025'],
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    const check = (value: Node | null, place: string) => {
      if (!value) return;
      const taint = ctx.taint.taintsOf(value).find((t) => t.kind === 'request' || t.kind === 'external');
      if (!taint) return;
      const label = shorten(valueLabel(ctx, value), 40);
      ctx.report(value, {
        message: `${place} includes text from ${taint.source} (${label}, line ${taint.line}).`,
        level: 'warn',
        trace: [
          { line: taint.line, note: `${label} comes from ${taint.source}` },
          { line: lineOf(value), note: 'reaches the system prompt' },
        ],
        key: label,
      });
    };
    const loop = (node: Node) => ctx.taint.enterLoop(node);
    return {
      ForOfStatement: loop,
      ForInStatement: loop,
      ObjectExpression(node: ObjectExpression) {
        const role = stringValue(objectProp(node, 'role'));
        if (role === 'system' || role === 'developer') check(objectProp(node, 'content'), `A ${role} message`);
        const parent = ctx.parents[ctx.parents.length - 1];
        if (!parent || (!isCallNode(parent) && parent.type !== 'NewExpression') || parent.arguments[0] !== node) return;
        const carrier = systemCarrier(ctx, parent);
        if (!carrier) return;
        for (const key of SYSTEM_KEYS) {
          const value = objectProp(node, key);
          if (value && value.type !== 'ObjectMethod') check(value, `The system prompt of ${carrier}`);
        }
        const config = unwrap(objectProp(node, 'config'));
        const nested = objectProp(config, 'systemInstruction');
        if (nested) check(nested, `The system prompt of ${carrier}`);
      },
      NewExpression(node: Node) {
        const n = node as { callee: Node; arguments: Node[] };
        const canonical = ctx.imports.canonical(n.callee) ?? '';
        if (!/(^|[.#])SystemMessage$/.test(canonical)) return;
        const arg = unwrap(n.arguments[0]);
        check(arg?.type === 'ObjectExpression' ? objectProp(arg, 'content') : (n.arguments[0] ?? null), 'A SystemMessage');
      },
      CallExpression(node: Node) {
        const n = node as { callee: Node; arguments: Node[] };
        const canonical = ctx.imports.canonical(n.callee) ?? '';
        if (/(^|[.#])SystemMessagePromptTemplate\.fromTemplate$/.test(canonical)) check(n.arguments[0] ?? null, 'A system prompt template');
        if (/(^|[.#])ChatPromptTemplate\.fromMessages$/.test(canonical)) {
          const list = unwrap(n.arguments[0]);
          if (list?.type !== 'ArrayExpression') return;
          for (const e of list.elements) {
            const pair = unwrap(e as Node | null);
            if (pair?.type !== 'ArrayExpression') continue;
            const [role, content] = pair.elements;
            if (stringValue(role as Node) === 'system') check((content as Node | null) ?? null, 'A system prompt template');
          }
        }
      },
    };
  },
};
