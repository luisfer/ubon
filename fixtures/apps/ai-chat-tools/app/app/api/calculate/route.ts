import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { auth } from '@/auth';

// Turns a question such as "15% of 240" into an arithmetic expression and evaluates it.
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { question } = await req.json();
  const { text } = await generateText({
    model: openai('gpt-4.1-mini'),
    prompt: `Write only a JavaScript arithmetic expression for: ${question}`,
    maxOutputTokens: 50,
  });
  const value = eval(text);
  return Response.json({ expression: text, value });
}
