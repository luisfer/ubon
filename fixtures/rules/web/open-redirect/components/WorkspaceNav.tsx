'use client';

import { useParams, useRouter } from 'next/navigation';

export function WorkspaceNav() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  return (
    <button type="button" onClick={() => router.push(`/${slug}/settings`)}> {/* ok: a route parameter as one path segment */}
      Settings
    </button>
  );
}
