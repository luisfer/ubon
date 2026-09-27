import { headers } from 'next/headers';
import { Webhook } from 'svix';
import { db } from '@/lib/db';

export async function POST(req: Request) {
  const payload = await req.text(); // ok: verified with svix below
  const h = await headers();
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
  const evt = wh.verify(payload, {
    'svix-id': h.get('svix-id')!,
    'svix-timestamp': h.get('svix-timestamp')!,
    'svix-signature': h.get('svix-signature')!,
  }) as { type: string; data: { id: string } };
  if (evt.type === 'user.created') await db.user.create({ data: { clerkId: evt.data.id } });
  return new Response('ok');
}
