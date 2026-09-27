// src/server/ is not part of the browser bundle.
import { createClient } from '@supabase/supabase-js';

export const seedClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); // ok: server-side seed script
