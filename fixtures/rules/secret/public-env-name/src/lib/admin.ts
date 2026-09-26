import { createClient } from '@supabase/supabase-js';

export const admin = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY); // expect: secret/public-env-name
export const other = import.meta.env.PUBLIC_DATABASE_URL; // ok: PUBLIC_ is only a public prefix in SvelteKit and Astro
