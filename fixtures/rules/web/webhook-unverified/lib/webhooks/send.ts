import { db } from '../db';

// Sends the app's own webhooks to customers: nothing is received here.
export async function sendWebhook(webhook: { id: string; url: string }, payload: { body: unknown }) {
  const body = JSON.stringify(payload.body);
  await fetch(webhook.url, { method: 'POST', body }); // ok: outgoing webhook
  await db.webhookDelivery.create({ data: { webhookId: webhook.id } });
}

export async function deliverPending(queue: { next(): Promise<{ id: string; url: string; payload: { body: unknown } } | null> }) {
  const job = await queue.next();
  if (job) await sendWebhook(job, job.payload); // ok: a sender, not a request handler
}
