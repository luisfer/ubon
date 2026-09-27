const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(id);
  return response;
}

export class Completions {
  constructor() {
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    this.endpoint = OPENAI_URL;
  }

  async complete(prompt) {
    const res = await fetchWithTimeout(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }, // expect-block: llm/browser-key
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
    });
    return res.json();
  }
}
