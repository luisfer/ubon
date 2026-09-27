alter table public.teams enable row level security;

drop table if exists public.old_sessions;

create table public.flags (id int, name text);
alter table public.flags enable row level security;
-- Turned off again while debugging:
alter table public.flags disable row level security; -- expect-block: data/rls-disabled

create table archive as select * from todos; -- expect-block: data/rls-disabled

create view public.user_directory as -- expect-warn: data/rls-disabled
  select id, username from public.profiles;

create view public.my_profile with (security_invoker = true) as -- ok: security_invoker applies the caller's row level security
  select * from public.profiles where id = auth.uid();

create materialized view public.task_counts as -- expect-warn: data/rls-disabled
  select user_id, count(*) from todos group by user_id;

create materialized view private.daily_stats as select 1 as n; -- ok: not in an exposed schema

create table public.events (id bigint, at timestamptz not null) partition by range (at);
alter table public.events enable row level security;
create table public.events_2024 partition of public.events -- expect-warn: data/rls-disabled
  for values from ('2024-01-01') to ('2025-01-01');
