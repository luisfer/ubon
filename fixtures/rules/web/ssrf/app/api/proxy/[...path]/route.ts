const UPSTREAM = process.env.UPSTREAM_URL ?? 'https://internal.example.com';

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM);
  return fetch(target); // ok: the path and query go to a fixed upstream origin
}
