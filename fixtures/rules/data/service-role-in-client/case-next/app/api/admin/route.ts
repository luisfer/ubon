import { createServiceClient } from '../../../lib/supabase';

export async function DELETE(request: Request) {
  const { id } = await request.json();
  await createServiceClient().from('posts').delete().eq('id', id); // ok: server code calls the service client
  return new Response(null, { status: 204 });
}
