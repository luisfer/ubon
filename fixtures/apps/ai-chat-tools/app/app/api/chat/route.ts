import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { shell } from '@/lib/tools/shell';
import { weather } from '@/lib/tools/weather';

export async function POST(req: Request) {
  const { messages, persona }: { messages: UIMessage[]; persona?: string } = await req.json();
  const result = streamText({
    model: openai('gpt-4.1'),
    system: `You are ${persona ?? 'a helpful assistant'} for Acme. Answer briefly.`,
    messages: convertToModelMessages(messages),
    tools: { weather, shell },
  });
  return result.toUIMessageStreamResponse();
}
