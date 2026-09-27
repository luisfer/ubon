import jwt, { type JwtPayload } from 'jsonwebtoken';
import { prisma } from './prisma';

export function getUserFromToken(token: string) {
  const { sub, email } = jwt.decode(token) as JwtPayload; // expect-block: web/jwt-unverified
  return { id: sub, email };
}

export async function verifyWithJwks(token: string) {
  const header = jwt.decode(token, { complete: true })?.header; // ok: reads the key ID, then verifies below
  const key = await getSigningKey(header?.kid);
  return jwt.verify(token, key, { algorithms: ['RS256'] }); // ok: fixed algorithms list
}

export function issueToken(userId: string) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  const { exp } = jwt.decode(token) as JwtPayload; // ok: our own token, signed on the line above
  return { token, expiresAt: exp };
}

async function findKeyOwner(token: string) {
  const decoded = jwt.decode(token) as { id?: string } | null; // ok: called from verifyToken, which verifies with the owner's key
  if (!decoded?.id) throw new Error('Invalid token');
  return prisma.user.findUniqueOrThrow({ where: { id: decoded.id } });
}

export async function verifyToken(token: string) {
  const owner = await findKeyOwner(token);
  return jwt.verify(token, process.env.JWT_SECRET + owner.email, { algorithms: ['HS256'] });
}

export function isTokenExpired(token: string): boolean {
  const { exp } = jwt.decode(token) as JwtPayload; // expect-warn: web/jwt-unverified
  return !exp || exp * 1000 < Date.now();
}

async function getSigningKey(kid: string | undefined): Promise<string> {
  return `key-${kid}`;
}
