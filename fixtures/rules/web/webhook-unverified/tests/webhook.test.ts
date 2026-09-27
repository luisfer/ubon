import { test } from 'node:test';

test('handles a fake event', async () => {
  const handler = async (req: Request) => {
    const body = await req.json(); // ok: tests post unsigned events on purpose
    return body;
  };
  await handler(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
});
