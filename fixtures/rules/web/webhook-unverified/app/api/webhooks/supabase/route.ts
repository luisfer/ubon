import { db } from '@/lib/db';

const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET;

// Supabase database webhooks send a shared secret in a header configured on the webhook.
export async function POST(req: Request) {
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
  const { record } = await req.json(); // ok: shared secret compared above through a constant
  await db.profile.upsert({ where: { id: record.id }, create: record, update: record });
  return new Response('ok');
}
