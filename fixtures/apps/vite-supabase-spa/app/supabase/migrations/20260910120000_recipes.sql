create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users default auth.uid(),
  title text not null,
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.recipes enable row level security;

create policy "Anyone can read recipes" on public.recipes
  for select using (true);

create policy "Anyone can add recipes" on public.recipes
  for insert with check (true);

insert into storage.buckets (id, name, public) values ('recipe-photos', 'recipe-photos', true);

create policy "Anyone can upload recipe photos" on storage.objects
  for insert with check (bucket_id = 'recipe-photos');
