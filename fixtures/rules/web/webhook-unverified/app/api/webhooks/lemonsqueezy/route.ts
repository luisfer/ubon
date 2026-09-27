import crypto from 'node:crypto';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const raw = await request.text(); // ok: HMAC compared with timingSafeEqual below
  const hmac = crypto.createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET!);
  const digest = Buffer.from(hmac.update(raw).digest('hex'), 'utf8');
  const signature = Buffer.from(request.headers.get('x-signature') ?? '', 'utf8');
  if (digest.length !== signature.length || !crypto.timingSafeEqual(digest, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }
  const event = JSON.parse(raw);
  await db.order.update({ where: { id: event.meta.custom_data.order_id }, data: { status: 'paid' } });
  return new Response('ok');
}
