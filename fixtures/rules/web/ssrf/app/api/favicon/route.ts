import { config } from '@/lib/config';

const FAVICONS = 'https://www.google.com/s2/favicons?sz=64&domain_url=';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain') ?? '';
  const icon = await fetch(`${FAVICONS}${domain}`); // ok: module constant fixes the host; the value goes in the query
  const path = searchParams.get('path') ?? '';
  const page = await fetch(`${config.upstream}${path}`); // expect-warn: web/ssrf
  return Response.json({ icon: icon.ok, page: page.ok });
}
