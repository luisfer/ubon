import axios from 'axios';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export async function chat(messages: Array<{ role: string; content: string }>) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`, // expect-block: llm/browser-key
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages }),
  });
  return res.json();
}

export async function geminiRest(prompt: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, { // expect-block: llm/browser-key
    method: 'POST',
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  return res.json();
}

export async function claude(prompt: string) {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] },
    { headers: { 'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }, // expect-block: llm/browser-key
  );
  return data;
}

export async function viaBackend(prompt: string, token: string) {
  const res = await fetch('/api/chat', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt }) }); // ok: the app's own API
  return res.json();
}

export async function weather(city: string) {
  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${import.meta.env.VITE_WEATHER_KEY}`); // ok: not an LLM API
  return res.json();
}
