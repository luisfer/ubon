import Stripe from 'npm:stripe@18';

// Registers the app's webhook endpoint with Stripe: it manages webhooks and receives none.
Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const body = await req.json(); // ok: webhook management, not a webhook receiver
  const endpoint = await stripe.webhookEndpoints.create({ url: body.url, enabled_events: ['checkout.session.completed'] });
  return Response.json({ id: endpoint.id });
});
