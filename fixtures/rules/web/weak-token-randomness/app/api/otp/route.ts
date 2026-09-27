import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export async function POST(request: Request) {
  const { email } = await request.json();
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // expect: web/weak-token-randomness
  await db.otp.create({ data: { email, otp } });
  return Response.json({ sent: true });
}

export async function PUT(request: Request) {
  const { email } = await request.json();
  const code = Math.floor(1000 + Math.random() * 9000); // expect: web/weak-token-randomness
  await sendEmail(email, `Your code is ${code}`);
  await db.verification.create({ data: { email, verificationCode: String(code) } });
  return Response.json({ sent: true });
}

export async function GET() {
  if (Math.random() < 0.1) console.info('sampled request'); // ok: sampling
  return Response.json({ ok: true });
}
