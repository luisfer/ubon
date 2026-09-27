import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = searchParams.get('next') ?? '/';
  if (searchParams.has('error')) return NextResponse.redirect(new URL('/login', request.url)); // ok: constant path on the request's own origin
  return NextResponse.redirect(new URL(next, request.url)); // expect: web/open-redirect
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('returnTo') ?? '/';
  const target = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  return NextResponse.redirect(new URL(target, request.url)); // ok: only relative paths pass the check
}

export async function PUT(request: Request) {
  const form = await request.formData();
  const callbackUrl = String(form.get('callbackUrl'));
  const url = new URL(callbackUrl, request.url);
  if (url.origin !== new URL(request.url).origin) return NextResponse.redirect(new URL('/', request.url));
  return NextResponse.redirect(url); // ok: origin compared with the request's origin
}
