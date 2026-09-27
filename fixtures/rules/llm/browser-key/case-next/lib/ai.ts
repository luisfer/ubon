import { createOpenAI } from '@ai-sdk/openai';

// Imported by a client component, so this module ships to the browser.
const provider = createOpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_KEY }); // expect-block: llm/browser-key

export const model = provider('gpt-4o-mini');
