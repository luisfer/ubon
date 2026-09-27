import OpenAI from 'openai';
import { useState } from 'react';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

export default function Assistant() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      instructions: 'You suggest recipes from the ingredients the user lists.',
      input: question,
    });
    setAnswer(response.output_text);
  }

  return (
    <form onSubmit={ask}>
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)} />
      <button type="submit">Ask</button>
      <p>{answer}</p>
    </form>
  );
}
