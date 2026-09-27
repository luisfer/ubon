create table "public"."posts" ( -- ok: enabled in a_security.sql
  "id" uuid primary key default gen_random_uuid(),
  "author" uuid not null,
  "body" text
);

create table "public"."reactions" ( -- expect-block: data/rls-disabled
  "post" uuid references "public"."posts",
  "emoji" text
);
