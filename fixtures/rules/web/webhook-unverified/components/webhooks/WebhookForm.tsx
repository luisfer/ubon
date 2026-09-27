'use client';

export function WebhookForm() {
  async function onSubmit(url: string) {
    const res = await fetch('/api/webhooks/settings', { method: 'POST', body: JSON.stringify({ url }) });
    const data = await res.json(); // ok: browser code reading a response
    return data;
  }
  return <form onSubmit={() => onSubmit('')} />;
}
