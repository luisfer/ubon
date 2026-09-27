-- Example projects are reported as warnings.
create table public.demo_notes (id int, body text); -- expect-warn: data/rls-disabled
