import Stripe from 'stripe';
import { auth } from '@/lib/auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Creates the checkout session; the webhook handles checkout.session.completed later.
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { priceId } = await req.json(); // ok: a signed-in checkout route, not a receiver
  const checkout = await stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }] });
  return Response.json({ url: checkout.url });
}
