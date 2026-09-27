import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file') as File;
  const name = String(form.get('name'));
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(`public/uploads/${name}`, bytes); // expect: web/path-traversal
  await writeFile(`public/uploads/${randomUUID()}.png`, bytes); // ok: file name generated on the server
  return Response.json({ ok: true });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  const doc = await readFile(`data/${id}.json`, 'utf8'); // ok: numeric cast
  const slug = searchParams.get('slug') ?? '';
  if (slug.includes('..') || slug.includes('/')) return new Response('bad slug', { status: 400 });
  const page = await readFile(`content/${slug}.md`, 'utf8'); // ok: rejects '..' and '/' first
  const theme = searchParams.get('theme') ?? 'light';
  const css = await readFile(`themes/${theme}.css`, 'utf8'); // expect: web/path-traversal
  return Response.json({ doc, page, css });
}
