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

create policy "Signed-in users add their own recipes" on public.recipes
  for insert to authenticated with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public) values ('recipe-photos', 'recipe-photos', true);

create policy "Signed-in users upload to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
