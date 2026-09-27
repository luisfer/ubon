import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { timingSafeCompare } from '@/lib/timing-safe-compare';

export async function POST(req: Request) {
  const rawBody = await req.text(); // ok: the signature is compared with a hash of the client secret and the body
  const signature = req.headers.get('X-HubSpot-Signature');
  const expected = crypto.createHash('sha256').update(`${process.env.HUBSPOT_CLIENT_SECRET}${rawBody}`).digest('hex');
  if (!signature || !timingSafeCompare(signature, expected)) return new Response('Invalid signature', { status: 401 });
  await db.event.create({ data: { payload: rawBody } });
  return new Response('ok');
}
