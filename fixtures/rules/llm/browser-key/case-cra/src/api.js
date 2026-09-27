import OpenAI from 'openai';

// Create React App inlines every REACT_APP_ variable into the bundle.
const client = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY, // expect-block: llm/browser-key
  dangerouslyAllowBrowser: true,
});

export async function complete(prompt) {
  const res = await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
  return res.choices[0].message.content;
}
