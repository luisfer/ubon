export async function POST(request: Request) {
  const event = await request.json(); // expect-warn: web/webhook-unverified
  console.log('resend event', event.type);
  return Response.json({ ok: true });
}
