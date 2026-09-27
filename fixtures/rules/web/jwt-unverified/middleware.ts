import { decodeJwt } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('session')?.value;
  if (!token) return NextResponse.redirect(new URL('/login', request.url));
  const payload = decodeJwt(token); // expect-block: web/jwt-unverified
  if (request.nextUrl.pathname.startsWith('/admin') && payload.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}
