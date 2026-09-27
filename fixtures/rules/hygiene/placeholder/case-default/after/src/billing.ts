export async function createInvoice(customerId: string): Promise<{ id: string }> {
  const res = await fetch('https://api.example.com/invoices', { // expect-warn: hygiene/placeholder
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BILLING_KEY ?? 'your-api-key-here'}` }, // expect-warn: hygiene/placeholder
    body: JSON.stringify({ customerId }),
  });
  return res.json();
}

// ok: a plain TODO about future work is fine
// TODO: add retries when the billing API times out
export function refund(): void {
  throw new Error('Not implemented'); // expect-warn: hygiene/placeholder
}

// TODO: implement
export function cancel(): void {}

// ok: a relative URL parsed against a dummy base
export const path = new URL('/invoices?page=2', 'https://example.com').pathname;

// ok: UI copy that says "your API key" is a label, not a placeholder value
export const label = 'Your API key';

export abstract class PaymentProvider {
  // ok: abstract base classes throw to force an override
  charge(): void {
    throw new Error('Not implemented');
  }
}
