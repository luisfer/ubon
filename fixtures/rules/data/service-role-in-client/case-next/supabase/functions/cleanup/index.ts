import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); // ok: Edge Functions run on the server
  await admin.from('sessions').delete().lt('expires_at', new Date().toISOString());
  return new Response('ok');
});
