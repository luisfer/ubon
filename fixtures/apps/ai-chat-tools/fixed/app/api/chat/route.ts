import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { auth } from '@/auth';
import { rateLimit } from '@/lib/rate-limit';
import { shell } from '@/lib/tools/shell';
import { weather } from '@/lib/tools/weather';

const PERSONAS = { support: 'a support assistant', sales: 'a sales assistant' } as const;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 });
  if (!rateLimit(session.user.email)) return new Response('Too many requests', { status: 429 });
  const { messages, persona }: { messages: UIMessage[]; persona?: keyof typeof PERSONAS } = await req.json();
  const role = PERSONAS[persona ?? 'support'] ?? PERSONAS.support;
  const result = streamText({
    model: openai('gpt-4.1'),
    system: `You are ${role} for Acme. Answer briefly.`,
    messages: convertToModelMessages(messages),
    tools: { weather, shell },
    maxOutputTokens: 1000,
  });
  return result.toUIMessageStreamResponse();
}
