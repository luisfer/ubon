import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';

export type Env = { Bindings: { DATABASE_URL: string; JWT_SECRET: string; ALLOWED_ORIGIN: string }; Variables: { userId: number; role: string } };

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('userId', Number(payload.sub));
    c.set('role', String(payload.role));
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};
