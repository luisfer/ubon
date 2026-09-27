drop policy if exists "Temporary open access" on public.posts;

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);

create policy "Avatar uploads" on storage.objects for insert to authenticated with check (bucket_id = 'avatars'); -- expect-block: data/permissive-policy

create policy "Own avatar uploads" on storage.objects for insert to authenticated with check ( -- ok: the folder must match the user id
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Avatars are public" on storage.objects for select using (bucket_id = 'avatars'); -- expect-warn: data/permissive-policy

CREATE POLICY "Enable insert for all users" ON "public"."feedback" -- expect-block: data/permissive-policy
  AS PERMISSIVE FOR INSERT
  TO "anon", "authenticated"
  WITH CHECK (true);

create table public.docs (id int, team_id int, body text);
alter table public.docs enable row level security;
create policy "Editors update docs" on public.docs for update using (public.is_editor(team_id)); -- ok: the alter below replaces this check
alter policy "Editors update docs" on public.docs using (true); -- expect-block: data/permissive-policy

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'Open comments') then
    create policy "Open comments" on public.comments for all to anon using (true); -- expect-block: data/permissive-policy
  end if;
end
$$;
