'use client';

export function Checkout() {
  const secret = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY; // expect: secret/public-env-name
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; // ok: publishable key
  return <form data-key={publishable} data-s={secret} />;
}
