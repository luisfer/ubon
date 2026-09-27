import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import { isPrivateIp } from '@/lib/net';

const ALLOWED_HOSTS = new Set(['images.example.com', 'docs.example.com']);

function reject(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

// Resolves the host and rejects private addresses, but DNS can answer differently when fetch() connects.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return reject('invalid url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return reject('unsupported protocol');
  const address = isIP(parsed.hostname) ? parsed.hostname : (await lookup(parsed.hostname)).address;
  if (parsed.hostname === 'localhost' || isPrivateIp(address)) return reject('private address');
  const upstream = await fetch(url, { redirect: 'manual' }); // expect-warn: web/ssrf
  return new Response(upstream.body, { status: upstream.status });
}

// Rejects two names; every other host, including internal ones, passes.
export async function POST(request: NextRequest) {
  const { url } = await request.json();
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return reject('local address');
  const upstream = await fetch(url); // expect: web/ssrf
  return Response.json({ status: upstream.status });
}

// Checks the host name as written, so a name that resolves to 10.0.0.5 passes.
export async function PUT(request: NextRequest) {
  const { url } = await request.json();
  const parsed = new URL(url);
  if (isPrivateIp(parsed.hostname)) return reject('private address');
  const upstream = await fetch(parsed); // expect: web/ssrf
  return Response.json({ status: upstream.status });
}

export async function PATCH(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('target') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return reject('invalid url');
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return reject('host not allowed');
  const upstream = await fetch(target); // ok: the host of the URL parsed from target is on an allowlist
  return Response.json({ status: upstream.status });
}

export async function DELETE(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('target') ?? '';
  const parsed = URL.parse(target);
  if (!parsed || !ALLOWED_HOSTS.has(parsed.hostname)) return reject('host not allowed');
  const upstream = await fetch(target, { method: 'DELETE' }); // ok: URL.parse result checked against an allowlist
  return Response.json({ status: upstream.status });
}
