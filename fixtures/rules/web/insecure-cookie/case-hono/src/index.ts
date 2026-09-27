import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';

const app = new Hono();

app.post('/login', async (c) => {
  const { token } = await c.req.json();
  setCookie(c, 'auth', token, { path: '/' }); // expect: web/insecure-cookie
  setCookie(c, 'auth', token, { path: '/', httpOnly: true, secure: true }); // ok: both flags
  setCookie(c, 'auth', token, { httpOnly: true, prefix: 'secure' }); // ok: the __Secure- prefix makes it secure
  setCookie(c, 'color_mode', 'dark'); // ok: not an auth cookie
  return c.json({ ok: true });
});

export default app;
