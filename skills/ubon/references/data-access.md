# Data access

Use when you create database tables, storage buckets, or access rules, especially with Supabase or Firebase, where the browser talks to the database directly.

## Supabase

The anon key in browser code is public. Row level security (RLS) is what protects the data. Every table in an exposed schema (`public` by default) needs RLS enabled and policies that say who can do what.

For each new table:

```sql
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  total_cents integer not null
);

alter table public.invoices enable row level security;

create policy "Users read their own invoices"
  on public.invoices for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own invoices"
  on public.invoices for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
```

- Write policies per operation (`select`, `insert`, `update`, `delete`), scoped to a role, with a condition on the row's owner or team.
- `using (true)` on a write policy lets anyone with the anon key change the data. Ubon blocks it (`data/permissive-policy`).
- The service role key bypasses RLS. It belongs in server code only; Ubon blocks it in browser code (`data/service-role-in-client`).
- Storage buckets need policies on `storage.objects` too, scoped by `bucket_id` and by the owner.
- Put schema changes in migration files (`supabase/migrations/`), not in the dashboard, so they are reviewed and checked.

## Firebase

Security rules in `firestore.rules`, `storage.rules`, and `database.rules.json` decide access. Rules that allow everything (`allow read, write: if true`) or the test-mode date rule are blocked (`data/firebase-open-rules`). Require `request.auth != null` and compare `request.auth.uid` with the document's owner field.

## Check

Run `ubon check` after writing migrations or rules. Then tell the user which tables and buckets you created and what their policies allow, in one line each.
