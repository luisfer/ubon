import Stripe from 'stripe';
import { upsertSubscription } from '@/lib/billing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text(); // ok: verified with constructEvent below
  const signature = req.headers.get('stripe-signature')!;
  const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  if (event.type === 'customer.subscription.updated') await upsertSubscription(event.data.object);
  return new Response('ok');
}
