'use client';
import { createClient } from '../lib/supabase';

export function Nav() {
  const supabase = createClient();
  return <button onClick={() => supabase.auth.signOut()}>Sign out</button>;
}
