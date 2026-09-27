import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const payload = await req.json(); // expect-block: web/webhook-unverified
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await supabase.from('users').upsert({ id: payload.data.id, email: payload.data.email_addresses[0].email_address });
  return new Response('ok');
});
