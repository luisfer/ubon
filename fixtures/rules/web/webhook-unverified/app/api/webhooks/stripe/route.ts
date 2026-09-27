import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const body = await req.text(); // expect-block: web/webhook-unverified
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const event = JSON.parse(body);
  if (event.type === 'checkout.session.completed') {
    await prisma.user.update({ where: { id: event.data.object.client_reference_id }, data: { plan: 'pro' } });
  }
  return new Response('ok');
}
