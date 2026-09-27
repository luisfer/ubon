// A single-page app: everything under src/ is bundled for the browser.
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;

export const supabase = createClient(url, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY); // ok: publishable key

const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
export const admin = createClient(url, serviceRoleKey); // expect-block: data/service-role-in-client

export const legacy = new SupabaseClient(url, '{{fake:supabase-secret}}'); // expect-block: data/service-role-in-client

export const fallback = createClient(url, import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''); // ok: anon key with a fallback
