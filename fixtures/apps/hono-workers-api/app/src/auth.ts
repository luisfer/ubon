import type { MiddlewareHandler } from 'hono';
import { decode } from 'hono/jwt';

export type Env = { Bindings: { DATABASE_URL: string; JWT_SECRET: string; ALLOWED_ORIGIN: string }; Variables: { userId: number; role: string } };

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const { payload } = decode(token);
  c.set('userId', Number(payload.sub));
  c.set('role', String(payload.role));
  await next();
};
