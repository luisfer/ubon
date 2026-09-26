import Stripe from 'stripe';

export const stripe = new Stripe('{{fake:stripe-live}}'); // expect-block: secret/provider-key
export const stripeTest = new Stripe('{{fake:stripe-test}}'); // expect-warn: secret/provider-key
export const publishable = 'pk_live_51HqLyjWDarjtT1zdp7dcXYZ123'; // ok: publishable keys are public by design
export const webhookSecret = '{{fake:stripe-webhook}}'; // expect: secret/provider-key
