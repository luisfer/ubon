import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RecipeForm } from '@/components/RecipeForm';

type Recipe = { id: string; title: string; photo_url: string | null };

export default function Index() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  useEffect(() => {
    supabase
      .from('recipes')
      .select('id, title, photo_url')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRecipes(data ?? []));
  }, []);
  return (
    <main>
      <h1>Recipe Box</h1>
      <RecipeForm onSaved={(r) => setRecipes([r, ...recipes])} />
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            {r.photo_url && <img src={r.photo_url} alt="" width={64} height={64} />}
            {r.title}
          </li>
        ))}
      </ul>
    </main>
  );
}
