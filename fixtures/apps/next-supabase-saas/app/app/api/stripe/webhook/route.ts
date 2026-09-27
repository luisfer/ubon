import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const event = await request.json();
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await supabaseAdmin.from('subscriptions').upsert({ user_id: session.client_reference_id, status: 'active', stripe_customer_id: session.customer });
  }
  return NextResponse.json({ received: true });
}
