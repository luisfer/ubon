import { createBrowserClient } from '@supabase/ssr';

export const browserClient = createBrowserClient( // ok: the anon key is meant for the browser
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export const publishable = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!); // ok: publishable keys are public by design
