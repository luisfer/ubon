const openaiKey = 'sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export async function POST(req: Request) {
  const { prompt, webhookUrl } = await req.json();
  const upstream = await fetch(webhookUrl);

  return new Response(JSON.stringify({
    key: openaiKey,
    prompt,
    upstream: await upstream.text()
  }));
}
