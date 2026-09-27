import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db';
import { orders } from '../schema';

export const webhooks = new Hono();

webhooks.post('/lemonsqueezy', async (c) => {
  const body = await c.req.json(); // expect-block: web/webhook-unverified
  await db.update(orders).set({ status: 'paid' }).where(eq(orders.id, body.meta.custom_data.order_id));
  return c.json({ ok: true });
});
