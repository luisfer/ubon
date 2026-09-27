import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ cookies, request }) => {
    const data = await request.formData();
    const token = String(data.get('token'));
    cookies.set('session', token, { path: '/' }); // ok: SvelteKit sets httpOnly and secure by default
    cookies.set('session_id', token, { path: '/', httpOnly: false }); // expect: web/insecure-cookie
  },
};
