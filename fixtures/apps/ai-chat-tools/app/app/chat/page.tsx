'use client';

import { useChat } from '@ai-sdk/react';
import { useState } from 'react';

export default function ChatPage() {
  const { messages, sendMessage } = useChat();
  const [input, setInput] = useState('');
  return (
    <main>
      {messages.map((m) => (
        <p key={m.id}>
          {m.role}: {m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} />
      </form>
    </main>
  );
}
