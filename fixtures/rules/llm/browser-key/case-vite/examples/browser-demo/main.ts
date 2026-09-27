import OpenAI from 'openai';

// A demo that shows browser usage of the SDK.
const client = new OpenAI({ apiKey: import.meta.env.VITE_OPENAI_API_KEY, dangerouslyAllowBrowser: true }); // expect-warn: llm/browser-key

export async function demo() {
  return client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
}
