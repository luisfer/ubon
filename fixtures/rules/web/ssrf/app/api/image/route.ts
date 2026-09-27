import { isAllowedUrl } from '@/lib/urls';

const ALLOWED_HOSTS = new Set(['images.example.com', 'cdn.example.com']);

export async function GET(request: Request) {
  const src = new URL(request.url).searchParams.get('src') ?? '';
  const parsed = new URL(src);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return new Response('forbidden', { status: 403 });
  const image = await fetch(parsed); // ok: hostname checked against an allowlist
  return new Response(image.body);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const target = String(form.get('webhook'));
  if (!isAllowedUrl(target)) return new Response('forbidden', { status: 403 });
  await fetch(target, { method: 'POST', body: '{}' }); // ok: validated by an allowlist helper
  const icon = new URL(String(form.get('icon')));
  if (!icon.hostname.endsWith('.example.com')) return new Response('forbidden', { status: 403 });
  await fetch(icon); // ok: hostname suffix check
  const callback = String(form.get('callback'));
  return fetch(new URL(callback)); // expect: web/ssrf
}
