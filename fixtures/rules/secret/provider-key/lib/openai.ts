import OpenAI from 'openai';

// A key pasted into code while "testing quickly".
export const openai = new OpenAI({ apiKey: '{{fake:openai-project}}' }); // expect: secret/provider-key

// ok: read from the environment
export const fromEnv = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ok: documentation placeholder with no entropy
export const placeholder = 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
