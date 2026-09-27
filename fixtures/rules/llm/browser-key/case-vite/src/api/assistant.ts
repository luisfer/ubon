import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

// src/api/ in a Vite app is browser code: the folder name does not make it a server.
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY?.trim();

export const client = new OpenAI({ apiKey: OPENAI_API_KEY }); // expect-block: llm/browser-key

function ensureGeminiKey(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) throw new Error('VITE_GEMINI_API_KEY is not set');
  return key;
}

export async function ask(prompt: string) {
  const ai = new GoogleGenAI({ apiKey: ensureGeminiKey() }); // expect-block: llm/browser-key
  return ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
}
