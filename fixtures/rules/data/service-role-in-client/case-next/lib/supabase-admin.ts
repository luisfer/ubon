// Imported by a client component, so this module ships to the browser.
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_SERVICE_ROLE_KEY: serviceRole } = process.env;

export const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRole!, { // expect-block: data/service-role-in-client
  auth: { persistSession: false },
});
