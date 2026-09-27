'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export function AfterLogin() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    router.push(params.get('callbackUrl') ?? '/'); // expect: web/open-redirect
  }, [params, router]);
  useEffect(() => {
    router.replace(`/onboarding?step=${params.get('step')}`); // ok: fixed path
  }, [params, router]);
  return null;
}

export function legacyRedirect() {
  window.location.href = new URLSearchParams(window.location.search).get('next') ?? '/'; // expect: web/open-redirect
}
