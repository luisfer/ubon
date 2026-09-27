import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './auth';
import { inviteRoutes } from './routes/invites';
import { postRoutes } from './routes/posts';

const app = new Hono<Env>();

app.use('*', cors({ origin: (origin) => origin, credentials: true }));

app.route('/posts', postRoutes);
app.route('/invites', inviteRoutes);

export default app;
