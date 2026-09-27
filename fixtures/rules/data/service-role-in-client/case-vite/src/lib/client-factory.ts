import { createClient as create } from '@supabase/supabase-js';

export function createClient() {
  return create(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY); // ok: anon key
}
