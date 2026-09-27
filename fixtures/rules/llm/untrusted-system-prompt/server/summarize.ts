import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import OpenAI from 'openai';

const app = new Hono();
const openai = new OpenAI();
const anthropic = new Anthropic();

app.post('/summarize', async (c) => {
  const { url, question, tone } = await c.req.json();
  const page = await (await fetch(url)).text();
  const response = await openai.responses.create({
    model: 'gpt-4.1',
    instructions: `Summarize using this page: ${page}`, // expect: llm/untrusted-system-prompt
    input: question, // ok: the user's question goes in the input
  });
  const chat = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: `Reply in a ${tone} tone.` }, // expect: llm/untrusted-system-prompt
      { role: 'user', content: question }, // ok: user message
      { role: 'user', content: `<document>${page}</document>` }, // ok: fetched text passed as data in a user message
    ],
  });
  const reply = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    system: c.req.query('system') ?? 'Be helpful.', // expect: llm/untrusted-system-prompt
    messages: [{ role: 'user', content: question }],
  });
  return c.json({ response: response.output_text, chat: chat.choices[0]?.message.content, reply });
});

export default app;
