'use client';

import Anthropic from '@anthropic-ai/sdk';

// The key is undefined in the browser; the likely next "fix" is a NEXT_PUBLIC_ prefix.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true }); // expect-warn: llm/browser-key

export function Assistant() {
  return <button onClick={() => anthropic.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 64, messages: [] })}>Ask</button>;
}
