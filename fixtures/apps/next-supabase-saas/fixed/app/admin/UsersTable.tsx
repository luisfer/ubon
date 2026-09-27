'use client';

import { useEffect, useState } from 'react';

export function UsersTable() {
  const [users, setUsers] = useState<{ id: string; email?: string }[]>([]);
  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => res.json())
      .then((data) => setUsers(data.users));
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
