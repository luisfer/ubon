create table public.projects (id uuid primary key, owner uuid); -- ok: the DO block below enables row level security on every public table
create table public.tasks (id uuid primary key, project uuid); -- ok: the DO block below enables row level security on every public table

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

create table public.comments (id uuid primary key, body text); -- expect-block: data/rls-disabled

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'labels') then
    create table public.labels (id int, name text); -- expect-block: data/rls-disabled
  end if;
end
$$;

do $$
begin
  create table public.tags (id int); -- ok: the EXECUTE string below enables it
  execute 'alter table public.tags enable row level security';
end
$$;
