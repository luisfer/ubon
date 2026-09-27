import { readFile } from 'node:fs/promises';
import { notFound } from 'next/navigation';
import { getGuide } from '@/lib/guides';

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = await getGuide(slug);
  if (!guide) notFound();
  const body = await readFile(`content/guides/${slug}.mdx`, 'utf8'); // expect-warn: web/path-traversal
  return (
    <article>
      <h1>{guide.title}</h1>
      <div>{body}</div>
    </article>
  );
}
