import { NextResponse } from 'next/server';

// Returns the title of a page, for link previews.
export async function POST(request: Request) {
  const { url } = await request.json();
  const res = await fetch(url);
  const html = await res.text();
  const title = /<title>(.*?)<\/title>/i.exec(html)?.[1] ?? url;
  return NextResponse.json({ title });
}
