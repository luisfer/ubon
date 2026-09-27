import { Hono } from 'hono';
import { useAgent } from 'request-filtering-agent';

const app = new Hono();

app.get('/unfurl', async (c) => {
  const url = c.req.query('url') ?? '';
  const res = await fetch(url, { agent: useAgent(url) } as RequestInit); // ok: request-filtering-agent blocks private addresses
  return c.text(await res.text());
});

export default app;
