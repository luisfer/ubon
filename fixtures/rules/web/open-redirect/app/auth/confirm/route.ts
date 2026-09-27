import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = requestUrl.searchParams.get('next');
  if (next) return NextResponse.redirect(requestUrl.origin + next); // expect: web/open-redirect
  const workspace = await currentWorkspace();
  return NextResponse.redirect(new URL(`/${workspace}/links?created=${requestUrl.searchParams.get('link')}`, request.url)); // ok: the value is in the query after a fixed path
}
