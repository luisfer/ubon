'use server';

import { redirect } from 'next/navigation';

export async function createPost(formData: FormData) {
  const slug = String(formData.get('slug'));
  const title = String(formData.get('title'));

  await savePost({ slug, title });
  redirect(`/posts/${slug}`);
}

async function savePost(input: { slug: string; title: string }) {
  return input;
}
