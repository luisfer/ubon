'use client';

import { useChat } from '@ai-sdk/react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function Chat() {
  const { messages, input } = useChat();
  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <div dangerouslySetInnerHTML={{ __html: marked.parse(m.content) }} /> {/* expect: llm/output-to-sink */}
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(m.content) as string) }} /> {/* ok: sanitized */}
          <p>{m.content}</p> {/* ok: JSX text is escaped */}
        </div>
      ))}
      <div dangerouslySetInnerHTML={{ __html: input }} /> {/* ok: the draft the user is typing is not model output (web/xss-html-sink warns) */}
    </div>
  );
}
