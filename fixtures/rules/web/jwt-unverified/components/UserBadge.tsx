'use client';

import { jwtDecode } from 'jwt-decode';

export function UserBadge({ token }: { token: string }) {
  const { name, role } = jwtDecode<{ name: string; role: string }>(token); // ok: browser code; the server verifies the token
  return role === 'admin' ? <b>{name}</b> : <span>{name}</span>;
}
