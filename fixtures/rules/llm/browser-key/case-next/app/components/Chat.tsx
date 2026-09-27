'use client';

import OpenAI from 'openai';
import { useState } from 'react';
import { model } from '../../lib/ai';

const openai = new OpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY, dangerouslyAllowBrowser: true }); // expect-block: llm/browser-key

export function Chat() {
  const [answer, setAnswer] = useState('');
  async function ask(question: string) {
    const res = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: question }] });
    setAnswer(res.choices[0]?.message.content ?? '');
  }
  return <button onClick={() => ask('hi')} data-model={String(model)}>{answer}</button>;
}
