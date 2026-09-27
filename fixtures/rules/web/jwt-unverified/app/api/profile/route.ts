import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.split(' ')[1] ?? '';
  const decoded = jwt.decode(token) as { userId: string } | null; // expect-block: web/jwt-unverified
  const user = await prisma.user.findUnique({ where: { id: decoded?.userId } });
  return Response.json(user);
}

export async function POST(request: Request) {
  const token = request.headers.get('authorization') ?? '';
  const claims = jwt.decode(token); // expect-warn: web/jwt-unverified
  return Response.json({ claims });
}
