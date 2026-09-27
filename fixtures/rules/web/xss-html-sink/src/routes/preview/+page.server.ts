import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

export const actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const markdown = String(form.get('markdown') ?? '');
    return { markdown, html: await marked.parse(markdown), clean: DOMPurify.sanitize(await marked.parse(markdown)), saved: 'Draft saved' };
  },
};
