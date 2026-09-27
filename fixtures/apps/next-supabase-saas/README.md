# next-supabase-saas

A Next.js App Router app with Supabase auth and data, and Stripe billing. `app/` has six planted problems, listed with their rules and lines in `EXPECTED.json`. `fixed/` holds corrected versions of the files that have them; the test copies `app/`, applies `fixed/` on top, and expects no findings.

| Problem | File |
| --- | --- |
| Service role key in a client component | `app/admin/UsersTable.tsx` |
| Stripe secret key behind `NEXT_PUBLIC_` | `app/dashboard/billing/BillingButton.tsx` |
| Table without row level security | `supabase/migrations/20260901000000_init.sql` |
| Stripe webhook without a signature check | `app/api/stripe/webhook/route.ts` |
| Open redirect after sign-in | `app/auth/callback/route.ts` |
| Server-side request to any URL (SSRF) | `app/api/og/route.ts` |
