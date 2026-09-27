import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { auth } from '@/auth';

/** Evaluates + - * / and parentheses over numbers, without running code. */
function evaluate(expression: string): number {
  const tokens = expression.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = (): number => {
    const t = next();
    if (t === '(') {
      const v = sum();
      next();
      return v;
    }
    if (t === '-') return -primary();
    return Number(t);
  };
  const product = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') v = next() === '*' ? v * primary() : v / primary();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

// Turns a question such as "15% of 240" into an arithmetic expression and evaluates it.
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { question } = await req.json();
  const { text } = await generateText({
    model: openai('gpt-4.1-mini'),
    prompt: `Write only an arithmetic expression for: ${question}`,
    maxOutputTokens: 50,
  });
  return Response.json({ expression: text, value: evaluate(text) });
}
