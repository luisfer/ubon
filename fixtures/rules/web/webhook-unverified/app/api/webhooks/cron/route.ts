import { db } from '@/lib/db';

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const job = await request.json(); // ok: shared secret checked above
  await db.job.update({ where: { id: job.id }, data: { ranAt: new Date() } });
  return new Response('ok');
}
