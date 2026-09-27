import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  request.cookies.set('session', 'refreshed'); // ok: request cookies are not sent to the browser
  response.cookies.set('auth-token', request.cookies.get('auth-token')?.value ?? '', { httpOnly: false, secure: true }); // expect: web/insecure-cookie
  return response;
}
