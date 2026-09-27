import { marked } from 'marked';

export const actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const markdown = String(form.get('markdown') ?? '');
    return { markdown, html: await marked.parse(markdown) };
  },
};
