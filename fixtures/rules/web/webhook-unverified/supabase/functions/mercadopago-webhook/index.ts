import { createClient } from 'npm:@supabase/supabase-js@2';

// Mercado Pago's documented check: fetch the payment from its API instead of trusting the body.
async function verifyPayment(id: string) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${Deno.env.get('MP_ACCESS_TOKEN')}` },
  });
  return res.ok ? await res.json() : null;
}

Deno.serve(async (req) => {
  const body = await req.json(); // ok: the payment is fetched back from the provider before any write
  const payment = await verifyPayment(body.data.id);
  if (payment?.status !== 'approved') return new Response('ignored');
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await supabaseClient.from('orders').update({ status: 'paid' }).eq('payment_id', payment.id);
  return new Response('ok');
});
