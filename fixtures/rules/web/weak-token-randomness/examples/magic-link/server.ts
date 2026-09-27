import { sendMail } from './mail';

export async function sendMagicLink(email: string) {
  const token = Math.random().toString(36).slice(2); // expect-warn: web/weak-token-randomness
  await sendMail(email, `https://example.com/login?token=${token}`);
}
