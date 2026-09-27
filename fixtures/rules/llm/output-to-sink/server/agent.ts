import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'node:child_process';
import OpenAI from 'openai';

const openai = new OpenAI();
const anthropic = new Anthropic();
const ALLOWED_COMMANDS = ['git status', 'npm test'];

export async function solve(task: string) {
  const completion = await openai.chat.completions.create({ model: 'gpt-4.1', messages: [{ role: 'user', content: task }] });
  const code = completion.choices[0]?.message.content ?? '';
  const result = eval(code); // expect: llm/output-to-sink

  const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 200, messages: [{ role: 'user', content: task }] });
  const block = msg.content[0];
  const command = block?.type === 'text' ? block.text.trim() : '';
  execSync(command); // expect: llm/output-to-sink
  if (ALLOWED_COMMANDS.includes(command)) execSync(command); // ok: checked against an allowlist first

  const call = completion.choices[0]?.message.tool_calls?.[0];
  const args = JSON.parse(call?.function.arguments ?? '{}');
  execSync(`grep -r ${args.pattern} src`); // expect: llm/output-to-sink
  return result;
}

export function explain(expression: string) {
  return eval(expression); // ok: not model output (reported by web/code-eval as warn)
}
