import { error } from '@sveltejs/kit';
import { getPost } from '$lib/server/db';

export const load = ({ params }) => {
  const post = getPost(params.slug);
  if (!post) error(404, 'Not found');
  return { post };
};
