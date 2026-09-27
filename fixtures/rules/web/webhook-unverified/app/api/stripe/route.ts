import { prisma } from '@/lib/prisma';

// A Stripe receiver outside a webhook path: the event types give it away.
export async function POST(req: Request) {
  const body = await req.json(); // expect-block: web/webhook-unverified
  switch (body.type) {
    case 'checkout.session.completed':
      await prisma.subscriber.create({ data: { email: body.data.object.customer_details.email } });
      break;
    case 'customer.subscription.deleted':
      await prisma.subscriber.delete({ where: { id: body.userId } });
      break;
  }
  return Response.json({ received: true });
}
