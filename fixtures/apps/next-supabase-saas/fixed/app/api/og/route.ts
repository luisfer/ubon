import { type NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set(['images.example.com', 'avatars.githubusercontent.com']);

// Proxies a project's cover image so social previews can use it.
export async function GET(request: NextRequest) {
  const image = request.nextUrl.searchParams.get('image');
  if (!image) return NextResponse.json({ error: 'image is required' }, { status: 400 });
  const url = new URL(image);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 });
  }
  const upstream = await fetch(url);
  return new NextResponse(upstream.body, {
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/png', 'cache-control': 'public, max-age=3600' },
  });
}
