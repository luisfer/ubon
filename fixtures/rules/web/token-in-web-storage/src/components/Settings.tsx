import { useEffect } from 'react';
import { useLocalStorage } from 'usehooks-ts';

export function Settings({ theme, locale, open, messages, maxTokens }: { theme: string; locale: string; open: boolean; messages: string[]; maxTokens: number }) {
  const [apiKey, setApiKey] = useLocalStorage('openai-api-key', ''); // expect: web/token-in-web-storage
  const [draft, setDraft] = useLocalStorage('chat-input', ''); // ok: a draft message
  useEffect(() => {
    localStorage.setItem('theme', theme); // ok: theme preference
    localStorage.setItem('locale', locale); // ok: language preference
    localStorage.setItem('sidebar:state', String(open)); // ok: UI state
    localStorage.setItem('chat-session', JSON.stringify(messages)); // ok: a chat transcript, not an auth session
    localStorage.setItem('maxTokens', String(maxTokens)); // ok: a model token limit
    sessionStorage.setItem('hasSeenOnboarding', 'true'); // ok: a flag
  }, [theme, locale, open, messages, maxTokens]);
  return <input value={apiKey || draft} onChange={(e) => (setApiKey(e.target.value), setDraft(''))} />;
}
