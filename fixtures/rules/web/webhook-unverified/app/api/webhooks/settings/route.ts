import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

// Manages the app's own outgoing webhook endpoints: a signed-in settings API, not a receiver.
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const body = await req.json(); // ok: authenticated settings endpoint
  await db.webhook.create({ data: { url: body.url, userId: session.user.id } });
  return Response.json({ ok: true });
}
