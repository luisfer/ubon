export async function POST(request: Request) {
  const { url, repo } = await request.json();
  const page = await fetch(url); // expect: web/ssrf
  const meta = await fetch(`https://api.github.com/repos/${repo}`); // ok: fixed scheme and host; request data only in the path
  const self = await fetch(new URL('/api/health', request.url)); // ok: same origin as the request
  return Response.json({ status: page.status, meta: meta.status, self: self.status });
}
