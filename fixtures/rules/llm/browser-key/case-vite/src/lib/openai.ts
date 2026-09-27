import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY, // expect-block: llm/browser-key
  dangerouslyAllowBrowser: true,
});

export function clientFor(userKey: string) {
  // Bring your own key: each user pastes their own key into the settings page.
  return new OpenAI({ apiKey: userKey, dangerouslyAllowBrowser: true }); // ok: the user's own key
}

export const viaProxy = new OpenAI({ baseURL: '/api/openai', apiKey: 'unused', dangerouslyAllowBrowser: true }); // ok: the app's own proxy holds the key

export const local = new OpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama', dangerouslyAllowBrowser: true }); // ok: a local model server
