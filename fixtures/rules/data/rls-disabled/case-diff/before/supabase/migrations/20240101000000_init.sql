-- Existing debt in a migration that this change does not touch.
create table public.legacy_logs (id bigserial primary key, line text); -- ok: existing debt in an unchanged migration is not reported in diff mode
