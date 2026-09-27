import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { db } from '@/lib/db';

export const POST = verifySignatureAppRouter(async (req: Request) => {
  const body = await req.json(); // ok: QStash signature verified by the wrapper
  await db.report.create({ data: { name: body.name } });
  return new Response('ok');
});
