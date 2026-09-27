import { Hono } from 'hono';
import { type Env, requireUser } from '../auth';
import { getDb } from '../db/client';
import { invites } from '../db/schema';

export const inviteRoutes = new Hono<Env>();

inviteRoutes.post('/', requireUser, async (c) => {
  if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const { email } = await c.req.json<{ email: string }>();
  const inviteCode = Math.random().toString(36).slice(2, 10);
  await getDb(c.env.DATABASE_URL).insert(invites).values({ code: inviteCode, email });
  return c.json({ code: inviteCode }, 201);
});
