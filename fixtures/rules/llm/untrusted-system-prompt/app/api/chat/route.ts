import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText } from 'ai';

const SYSTEM = 'You are a support assistant for Acme. Answer briefly.';

export async function POST(req: Request) {
  const { messages, persona } = await req.json();
  const result = streamText({
    model: openai('gpt-4.1'),
    system: `You are ${persona}. Answer briefly.`, // expect: llm/untrusted-system-prompt
    messages: convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}

export async function PUT(req: Request) {
  const { messages } = await req.json();
  const result = streamText({
    model: openai('gpt-4.1'),
    system: SYSTEM, // ok: constant system prompt
    messages: convertToModelMessages(messages), // ok: user messages are where user text belongs
  });
  return result.toUIMessageStreamResponse();
}
