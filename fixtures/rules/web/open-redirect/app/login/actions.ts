'use server';

import { redirect } from 'next/navigation';

export async function login(formData: FormData) {
  let destination = String(formData.get('redirect_to') ?? '/');
  if (!destination.startsWith('/')) destination = '/';
  redirect(destination); // expect: web/open-redirect
}

export async function logout(formData: FormData) {
  const pathname = String(formData.get('from') ?? '/');
  redirect(`/login?next=${encodeURIComponent(pathname)}`); // ok: fixed path; the value is only in the query
}
