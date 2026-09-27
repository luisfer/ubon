import { createClient } from './client-factory';

// A local wrapper named createClient takes no key; it is not the Supabase factory.
export const client = createClient(); // ok: local wrapper, not @supabase/supabase-js
