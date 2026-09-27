// A shared module: client components import createClient from here, so the whole module ships to the browser.
import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export function createClient() {
  return createBrowserClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!); // ok: anon key in the browser
}

/** Only route handlers call this one. */
export function createServiceClient() {
  return createSupabaseClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!); // expect-warn: data/service-role-in-client
}

/** A client component calls this one. */
export function createAuditClient() {
  return createSupabaseClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!); // expect-block: data/service-role-in-client
}
