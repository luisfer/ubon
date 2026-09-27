import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function handleStripe(req: Request) {
  const event = await req.json(); // expect-block: web/webhook-unverified
  if (event.type === 'checkout.session.completed') {
    await supabaseClient.from('profiles').update({ plan: 'pro' }).eq('id', event.data.object.client_reference_id);
  }
  return new Response('ok');
}

Deno.serve(async (req) => {
  // TODO: verify the Stripe signature
  const url = new URL(req.url);
  if (url.searchParams.get('provider') === 'stripe') return handleStripe(req);
  return new Response('unknown provider', { status: 400 });
});
