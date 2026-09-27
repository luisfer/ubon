import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export default function Assistant() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    // The OpenAI key stays in the edge function; the browser sends the signed-in user's session.
    const { data } = await supabase.functions.invoke('assistant', { body: { question } });
    setAnswer(data?.answer ?? '');
  }

  return (
    <form onSubmit={ask}>
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)} />
      <button type="submit">Ask</button>
      <p>{answer}</p>
    </form>
  );
}
