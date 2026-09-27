'use client';

import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY!);

export function BillingButton() {
  async function upgrade() {
    const stripe = await stripePromise;
    const res = await fetch('/api/checkout', { method: 'POST' });
    const { sessionId } = await res.json();
    await stripe?.redirectToCheckout({ sessionId });
  }
  return <button onClick={upgrade}>Upgrade to Pro</button>;
}
