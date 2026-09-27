'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    setSent(true);
  }

  if (sent) return <p>Check your email for a sign-in link.</p>;
  return (
    <form onSubmit={signIn}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit">Send link</button>
    </form>
  );
}
