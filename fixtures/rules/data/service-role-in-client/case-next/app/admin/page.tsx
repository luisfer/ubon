'use client';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { adminClient } from '../../lib/supabase-admin';
import { browserClient } from '../../lib/supabase-browser';
import { banUser } from './actions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

// The agent "fixed" an undefined key by giving it a public prefix.
const admin = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!); // expect-block: data/service-role-in-client

const serviceKey = '{{fake:supabase-service-jwt}}';

export default function AdminPage() {
  const [users, setUsers] = useState<unknown[]>([]);
  useEffect(() => {
    const client = createClient(supabaseUrl, serviceKey); // expect-block: data/service-role-in-client
    client.from('profiles').select('*').then(({ data }) => setUsers(data ?? []));
    const anon = createClient(supabaseUrl, '{{fake:supabase-anon-jwt}}'); // ok: the anon key is public by design
    void anon;
  }, []);
  void admin;
  void adminClient;
  void browserClient;
  void banUser;
  return <pre>{JSON.stringify(users)}</pre>;
}
