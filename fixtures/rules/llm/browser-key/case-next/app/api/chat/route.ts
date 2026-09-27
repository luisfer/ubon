import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import OpenAI from 'openai';

const openai = new OpenAI(); // ok: route handlers run on the server
const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY }); // ok: server-only key in a route handler

export async function POST(request: Request) {
  const { messages } = await request.json();
  const moderation = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, // ok: server code
    body: JSON.stringify({ input: messages.at(-1)?.content ?? '' }),
  });
  if (!moderation.ok) return new Response('blocked', { status: 400 });
  void openai;
  return streamText({ model: provider('gpt-4o-mini'), messages }).toTextStreamResponse();
}
