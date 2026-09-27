'use client';

import Cookies from 'js-cookie';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';

export function LoginForm({ onDone }: { onDone: () => void }) {
  async function onSubmit(token: string) {
    document.cookie = `token=${token}; path=/; max-age=86400`; // expect: web/insecure-cookie
    Cookies.set('access_token', token, { secure: true, sameSite: 'strict' }); // expect: web/insecure-cookie
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${true}; path=/`; // ok: not an auth cookie
    document.cookie = 'token=; Max-Age=0; path=/'; // ok: deleting the cookie
    onDone();
  }
  return <form onSubmit={() => onSubmit('')} />;
}
