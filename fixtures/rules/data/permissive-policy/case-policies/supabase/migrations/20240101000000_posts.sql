create table public.posts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users not null default auth.uid(),
  body text
);
alter table public.posts enable row level security;

create policy "Anyone can read posts" on public.posts for select using (true); -- expect-warn: data/permissive-policy

create policy "Anyone can create posts" on public.posts for insert with check (true); -- expect-block: data/permissive-policy

create policy "Signed-in users can edit posts" on public.posts -- expect-block: data/permissive-policy
  for update to authenticated
  using (true);

create policy "Logged-in users can delete" on public.posts -- expect-block: data/permissive-policy
  for delete using (auth.role() = 'authenticated');

create policy "Owners can edit their posts" on public.posts -- ok: checks the row owner
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owners can delete their posts" on public.posts for delete using (auth.uid() = user_id); -- ok: checks the row owner

create policy "Service role manages posts" on public.posts for all to service_role using (true) with check (true); -- ok: only the service_role, which bypasses row level security anyway

create policy "Hide flagged posts" on public.posts as restrictive for select to authenticated using (true); -- ok: restrictive policies only narrow access

create policy "Temporary open access" on public.posts for all using (true); -- ok: dropped in a later migration

create policy "Private log writes" on private.audit for insert with check (true); -- ok: the private schema is not exposed through the Data API

create table public.notes (id int, user_id uuid, body text);
alter table public.notes enable row level security;
create policy "Users update own notes" on public.notes -- expect-warn: data/permissive-policy
  for update using (auth.uid() = user_id) with check (true);
