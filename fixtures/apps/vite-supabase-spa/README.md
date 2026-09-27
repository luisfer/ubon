# vite-supabase-spa

A single-page React app built with Vite and Supabase, in the shape Lovable exports: the Supabase URL and anon key are in client code and in a committed `.env`, which is correct, because both are public by design. Ubon must not report them.

| Problem | File |
| --- | --- |
| Anyone can insert rows (`with check (true)`) | `supabase/migrations/20260910120000_recipes.sql` |
| Anyone can upload to a public storage bucket | `supabase/migrations/20260910120000_recipes.sql` |
| OpenAI key in browser code (`VITE_OPENAI_API_KEY`, `dangerouslyAllowBrowser: true`) | `src/pages/Assistant.tsx` |

`fixed/` moves the OpenAI call into a Supabase Edge Function that checks the user, and limits both policies to signed-in users writing their own rows and files. `EXPECTED.json` lists every finding with its rule and line.
