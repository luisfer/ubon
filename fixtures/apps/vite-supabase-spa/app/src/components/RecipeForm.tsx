import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

type Recipe = { id: string; title: string; photo_url: string | null };

export function RecipeForm({ onSaved }: { onSaved: (recipe: Recipe) => void }) {
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    let photo_url: string | null = null;
    if (photo) {
      const path = `${crypto.randomUUID()}-${photo.name}`;
      await supabase.storage.from('recipe-photos').upload(path, photo);
      photo_url = supabase.storage.from('recipe-photos').getPublicUrl(path).data.publicUrl;
    }
    const { data } = await supabase.from('recipes').insert({ title, photo_url }).select().single();
    if (data) onSaved(data);
    setTitle('');
  }

  return (
    <form onSubmit={save}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recipe name" required />
      <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      <button type="submit">Save</button>
    </form>
  );
}
