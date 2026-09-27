'use client';

import { useState } from 'react';
import { generateUUID } from '../lib/utils';

const COLORS = ['#f87171', '#60a5fa', '#34d399'];

export function ChatList({ items }: { items: string[] }) {
  const [width] = useState(() => `${Math.floor(Math.random() * 40) + 50}%`); // ok: skeleton width for the UI
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]; // ok: picking an item from a list
  const maxTokens = Math.floor(Math.random() * 500) + 100; // ok: a token count, not a credential
  const showPasswordHint = Math.random() > 0.5; // ok: a comparison is sampling, not generation
  const messages = items.map((text) => ({ id: generateUUID(), text })); // ok: message IDs are not credentials
  return (
    <ul style={{ width, color }} data-max={maxTokens} data-hint={showPasswordHint}>
      {messages.map((m) => (
        <li key={Math.random()}>{m.text} {/* ok: list keys are not credentials */}</li>
      ))}
    </ul>
  );
}
