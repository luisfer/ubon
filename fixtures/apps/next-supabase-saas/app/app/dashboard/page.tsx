import { createClient } from '@/lib/supabase/server';
import { BillingButton } from './billing/BillingButton';

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: projects } = await supabase.from('projects').select('id, name, created_at').order('created_at');
  return (
    <main>
      <h1>Your projects</h1>
      <ul>
        {projects?.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ul>
      <BillingButton />
    </main>
  );
}
