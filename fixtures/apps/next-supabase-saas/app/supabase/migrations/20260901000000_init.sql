create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own profile" on public.profiles
  for select using ((select auth.uid()) = id);

create policy "Users update their own profile" on public.profiles
  for update using ((select auth.uid()) = id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  status text not null,
  stripe_customer_id text
);

alter table public.subscriptions enable row level security;

create policy "Users read their own subscription" on public.subscriptions
  for select using ((select auth.uid()) = user_id);
