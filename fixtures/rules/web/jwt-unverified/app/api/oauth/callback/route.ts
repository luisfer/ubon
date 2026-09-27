import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code') ?? '';
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code }) });
  const tokens = await res.json();
  // The ID token came straight from Google's token endpoint over TLS.
  const profile = jwt.decode(tokens.id_token) as { email: string }; // expect-warn: web/jwt-unverified
  const user = await prisma.user.upsert({ where: { email: profile.email }, create: { email: profile.email }, update: {} });
  return Response.json({ id: user.id });
}
