-- The migration an agent just wrote.
create table public.invoices ( -- expect-block: data/rls-disabled
  id uuid primary key default gen_random_uuid(),
  customer uuid not null,
  amount_cents integer not null
);

create table public.invoice_lines ( -- ok: row level security enabled in the same migration
  invoice uuid references public.invoices,
  description text
);
alter table public.invoice_lines enable row level security;
