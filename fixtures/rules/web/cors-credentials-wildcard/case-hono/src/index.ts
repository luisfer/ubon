import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('/api/*', cors({ origin: (origin) => origin, credentials: true })); // expect-block: web/cors-credentials-wildcard
app.use('/public/*', cors()); // ok: public routes without credentials
app.use('/app/*', cors({ origin: (origin) => (origin.endsWith('.example.com') ? origin : null), credentials: true })); // ok: the callback checks the domain

export default app;
