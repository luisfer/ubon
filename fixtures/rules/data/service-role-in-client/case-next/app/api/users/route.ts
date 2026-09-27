import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); // ok: route handlers run on the server
  const { data } = await admin.auth.admin.listUsers();
  return Response.json({ count: data.users.length });
}
