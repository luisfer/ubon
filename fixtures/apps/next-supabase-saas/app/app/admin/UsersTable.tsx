'use client';

import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);

export function UsersTable() {
  const [users, setUsers] = useState<{ id: string; email?: string }[]>([]);
  useEffect(() => {
    admin.auth.admin.listUsers().then(({ data }) => setUsers(data.users));
  }, []);
  return (
    <table>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
