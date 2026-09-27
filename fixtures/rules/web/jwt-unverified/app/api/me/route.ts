import { Hono } from 'hono';
import { decode } from 'hono/jwt';
import { handle } from 'hono/vercel';
import { db, eq, users } from '@/lib/db';

const app = new Hono().basePath('/api');

app.get('/me', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ?? '';
  const { payload } = decode(token); // expect-block: web/jwt-unverified
  const [user] = await db.select().from(users).where(eq(users.id, payload.sub as string));
  return c.json(user);
});

export const GET = handle(app);
