export async function POST() {
  const key = process.env.OPENAI_API_KEY; // ok: route handlers run on the server
  return Response.json({ ok: Boolean(key) });
}
