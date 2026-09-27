import { redirect } from '@sveltejs/kit';
import { marked } from 'marked';
import { createPost } from '$lib/server/db';

export const actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const title = String(form.get('title'));
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    createPost({ slug, title, html: await marked.parse(String(form.get('markdown'))) });
    redirect(303, `/posts/${slug}`);
  },
};
