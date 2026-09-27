-- Initial schema.

create table public.profiles ( -- ok: row level security is enabled right below
  id uuid primary key references auth.users on delete cascade,
  username text unique,
  avatar_url text
);
alter table public.profiles enable row level security;

create table todos ( -- expect-block: data/rls-disabled
  id bigint generated always as identity primary key,
  user_id uuid references auth.users not null,
  task text check (char_length(task) > 3),
  is_complete boolean default false
);

CREATE TABLE IF NOT EXISTS "public"."Audit Log" ( -- expect-block: data/rls-disabled
  "id" bigserial primary key,
  "note" text default 'created; not reviewed'
);

create schema if not exists private;
create table private.api_keys ( -- ok: the private schema is not exposed through the Data API
  id bigserial primary key,
  hashed text not null
);

create temporary table import_scratch (line text); -- ok: temporary tables are not exposed

create table api.orders ( -- expect-block: data/rls-disabled
  id bigserial primary key,
  total numeric
);

create table public.teams ( -- ok: a later migration enables row level security
  id uuid primary key default gen_random_uuid(),
  name text
);

create table staging_items (id int); -- ok: renamed below, and the new name gets row level security
alter table staging_items rename to items;
alter table public.items enable row level security;

create table public.old_sessions (id int); -- ok: dropped in the next migration

create table public.service_jobs (id int, payload jsonb); -- ok: anon and authenticated lose every privilege below
revoke all on table public.service_jobs from anon, authenticated;

create function public.touch() returns trigger language plpgsql as $$
begin
  -- A statement inside a function body; the semicolons here do not end the migration statement.
  new.updated_at = now();
  return new;
end;
$$;
