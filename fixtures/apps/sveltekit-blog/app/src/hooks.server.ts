import type { Handle } from '@sveltejs/kit';
import { userForSession } from '$lib/server/db';

export const handle: Handle = async ({ event, resolve }) => {
  const sid = event.cookies.get('sid');
  event.locals.user = sid ? userForSession(sid) : null;
  return resolve(event);
};
