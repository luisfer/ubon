import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const event = req.body; // expect-block: web/webhook-unverified
  if (event.type === 'user.created') {
    await supabase.from('profiles').insert({ id: event.data.id, email: event.data.email_addresses[0].email_address });
  }
  res.status(200).json({ received: true });
}
