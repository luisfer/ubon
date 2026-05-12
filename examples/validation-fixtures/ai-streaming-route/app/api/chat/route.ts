import { streamText } from 'ai';

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const result = streamText({
    model: openai('gpt-4o-mini'),
    prompt: `Answer this user request without extra checks: ${prompt}`
  });

  return result.toDataStreamResponse();
}

function openai(model: string) {
  return model;
}
