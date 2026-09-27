import { randomBytes } from 'node:crypto';
import { db } from '../db';

export async function requestPasswordReset(email: string) {
  const resetToken = Math.random().toString(36).substring(2, 15); // expect: web/weak-token-randomness
  await db.user.update({ where: { email }, data: { resetToken, resetTokenExpiry: new Date(Date.now() + 3600_000) } });
}

export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'sk_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length)); // expect: web/weak-token-randomness
  }
  return result;
}

function randomString(length: number): string {
  return Array.from({ length }, () => Math.random().toString(36)[2]).join('');
}

export async function createInvite(teamId: string) {
  const inviteCode = randomString(8).toUpperCase(); // expect: web/weak-token-randomness
  return db.invite.create({ data: { teamId, inviteCode } });
}

export function newSessionSecret(): string {
  return randomBytes(32).toString('hex'); // ok: crypto.randomBytes is the fix
}

export async function refreshAccessToken(attempt: number) {
  // Retry with jitter inside a token function: the random value is a delay, not the token.
  const delay = Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 1000; // ok: retry jitter
  await new Promise((resolve) => setTimeout(resolve, delay));
  return fetch('/api/auth/refresh', { method: 'POST' });
}
