create table public.messages (id bigint primary key, room text, sender uuid, body text);
alter table public.messages enable row level security;
create policy "Anyone can post" on public.messages for insert with check (true); -- ok: existing policy in an unchanged migration is not reported in diff mode
