export async function createInvoice(customerId: string): Promise<{ id: string }> {
  const res = await fetch(`${process.env.BILLING_URL}/invoices`, {
    method: 'POST',
    body: JSON.stringify({ customerId }),
  });
  return res.json();
}

// TODO: add retries when the billing API times out
export function refund(): void {}
