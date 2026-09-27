import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './auth';
import { inviteRoutes } from './routes/invites';
import { postRoutes } from './routes/posts';

const app = new Hono<Env>();

app.use('*', (c, next) => cors({ origin: c.env.ALLOWED_ORIGIN, credentials: true })(c, next));

app.route('/posts', postRoutes);
app.route('/invites', inviteRoutes);

export default app;
