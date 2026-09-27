import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function streamInto(output: HTMLElement, prompt: string) {
  const result = streamText({ model: openai('gpt-4.1-mini'), prompt });
  let html = '';
  for await (const delta of result.textStream) {
    html += delta;
    output.innerHTML = html; // expect: llm/output-to-sink
  }
  output.textContent = await result.text; // ok: textContent is not parsed as HTML
}
