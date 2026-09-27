'use server';
import { createClient } from '@supabase/supabase-js';

export async function banUser(id: string) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!); // ok: a Server Action module stays on the server
  await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
}
