import { listPosts } from '$lib/server/db';

export const load = () => ({ posts: listPosts() });
