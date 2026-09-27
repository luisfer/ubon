'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export function LinkPreview() {
  const params = useSearchParams();
  const [html, setHtml] = useState('');
  useEffect(() => {
    fetch(params.get('u') ?? '/').then((r) => r.text()).then(setHtml); // ok: the browser makes this request, not the server
  }, [params]);
  return <pre>{html}</pre>;
}
