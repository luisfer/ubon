// Imported by a client component, so this module ships to the browser.
export const stripeKey = process.env.STRIPE_SECRET_KEY; // expect-warn: secret/server-env-in-client
export const apiBase = process.env.INTERNAL_API_URL; // ok: not a secret name; often a server-only flag in a shared module
