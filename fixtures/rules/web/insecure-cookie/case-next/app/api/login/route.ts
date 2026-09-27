import { serialize } from 'cookie';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

export async function POST(request: Request) {
  const { token } = await request.json();
  const cookieStore = await cookies();
  cookieStore.set('session', token); // expect: web/insecure-cookie
  cookieStore.set('session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' }); // ok: secure depends on NODE_ENV
  (await cookies()).set({ name: 'refresh_token', value: token, httpOnly: true }); // expect: web/insecure-cookie
  cookieStore.set('sid', token, COOKIE_OPTIONS); // ok: the options constant sets both flags
  cookieStore.set('sid', token, { ...COOKIE_OPTIONS, maxAge: 3600 }); // ok: spread of the options constant
  cookieStore.set('theme', 'dark'); // ok: not an auth cookie
  cookieStore.set('sidebar_state', 'open'); // ok: not an auth cookie
  cookieStore.set('session', '', { maxAge: 0 }); // ok: clearing the cookie
  if (process.env.NODE_ENV === 'development') {
    cookieStore.set('session', token, { httpOnly: true }); // ok: secure is not needed in a development-only branch
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('access_token', token, { secure: true }); // expect: web/insecure-cookie
  res.headers.append('Set-Cookie', serialize('auth', token, { path: '/' })); // expect: web/insecure-cookie
  res.headers.append('Set-Cookie', `jwt=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`); // ok: flags in the header string
  return res;
}
