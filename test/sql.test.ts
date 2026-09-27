import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type SqlCommand,
  expressionText,
  formatName,
  parseSqlCommand,
  scanSqlFile,
  splitSqlStatements,
  tokenizeSql,
} from '../src/lang/sql.ts';

/** Statement texts (whitespace collapsed) with their start lines. */
function statements(sql: string): Array<[number, string]> {
  return splitSqlStatements(sql).map((s) => [s.line, sql.slice(s.start, s.end).replace(/\s+/g, ' ')]);
}

function command(sql: string): SqlCommand {
  const [stmt] = splitSqlStatements(sql);
  assert.ok(stmt, 'expected a statement');
  return parseSqlCommand(stmt);
}

test('sql: semicolons inside strings, identifiers, and comments do not split statements', () => {
  const sql = [
    "insert into notes (body) values ('a; b', E'it\\'s; fine');",
    'create table "odd;name" (id int); -- trailing; comment',
    '/* block; /* nested; */ still comment; */ select 1;',
  ].join('\n');
  assert.deepEqual(statements(sql), [
    [1, "insert into notes (body) values ('a; b', E'it\\'s; fine')"],
    [2, 'create table "odd;name" (id int)'],
    [3, 'select 1'],
  ]);
});

test('sql: dollar-quoted bodies keep their semicolons', () => {
  const sql = [
    'create function touch() returns trigger language plpgsql as $$',
    'begin',
    '  new.updated_at = now();',
    '  return new;',
    'end;',
    '$$;',
    'create function tagged() returns text language sql as $body$ select $$x;y$$ $body$;',
    'select 2;',
  ].join('\n');
  const out = statements(sql);
  assert.equal(out.length, 3);
  assert.equal(out[0]?.[0], 1);
  assert.equal(out[1]?.[0], 7);
  assert.deepEqual(out[2], [8, 'select 2']);
});

test('sql: BEGIN ATOMIC bodies, psql meta-commands, and COPY data', () => {
  const sql = [
    'create function one() returns int language sql',
    'begin atomic',
    '  select case when true then 1 else 2 end;',
    'end;',
    '\\connect postgres',
    'copy public.items (name) from stdin;',
    "it's; data",
    '\\.',
    'create table after_copy (id int);',
  ].join('\n');
  assert.deepEqual(
    statements(sql).map(([line, text]) => [line, text.slice(0, 40)]),
    [
      [1, 'create function one() returns int langua'],
      [6, 'copy public.items (name) from stdin'],
      [9, 'create table after_copy (id int)'],
    ],
  );
});

test('sql: tokens fold unquoted words to lower case and keep quoted identifiers exact', () => {
  const tokens = tokenizeSql('ALTER TABLE "Public"."UserData" ENABLE ROW LEVEL SECURITY');
  assert.deepEqual(
    tokens.map((t) => [t.type, t.value]),
    [
      ['word', 'alter'],
      ['word', 'table'],
      ['ident', 'Public'],
      ['op', '.'],
      ['ident', 'UserData'],
      ['word', 'enable'],
      ['word', 'row'],
      ['word', 'level'],
      ['word', 'security'],
    ],
  );
});

test('sql: create table shapes', () => {
  assert.deepEqual(command('create table if not exists public."User Profiles" (id uuid primary key);'), {
    kind: 'create-table',
    name: { schema: 'public', name: 'User Profiles' },
    ifNotExists: true,
    partitionOf: null,
    asQuery: false,
    temporary: false,
    unlogged: false,
    foreign: false,
  });
  const temp = command('create temp table scratch (id int);');
  assert.equal(temp.kind === 'create-table' && temp.temporary, true);
  const part = command("create table sales_2024 partition of sales for values from ('2024-01-01') to ('2025-01-01');");
  assert.equal(part.kind === 'create-table' && part.partitionOf?.name, 'sales');
  const ctas = command('create table archived as select * from orders;');
  assert.equal(ctas.kind === 'create-table' && ctas.asQuery, true);
  const unlogged = command('CREATE UNLOGGED TABLE cache (k text);');
  assert.equal(unlogged.kind === 'create-table' && unlogged.unlogged, true);
  const foreign = command('create foreign table remote_users (id int) server s;');
  assert.equal(foreign.kind === 'create-table' && foreign.foreign, true);
});

test('sql: alter table actions', () => {
  const multi = command('alter table only public.accounts enable row level security, force row level security;');
  assert.deepEqual(multi.kind === 'alter-relation' && multi.actions, [{ type: 'enable-rls' }, { type: 'force-rls' }]);
  const off = command('ALTER TABLE IF EXISTS profiles DISABLE ROW LEVEL SECURITY;');
  assert.deepEqual(off.kind === 'alter-relation' && [off.name, off.actions], [{ schema: null, name: 'profiles' }, [{ type: 'disable-rls' }]]);
  assert.deepEqual((command('alter table a rename to b;') as { actions: unknown }).actions, [{ type: 'rename', to: 'b' }]);
  assert.deepEqual((command('alter table a rename column x to y;') as { actions: unknown }).actions, [{ type: 'other' }]);
  assert.deepEqual((command('alter table a set schema private;') as { actions: unknown }).actions, [{ type: 'set-schema', schema: 'private' }]);
  const view = command('alter view public.v set (security_invoker = on);');
  assert.deepEqual(view.kind === 'alter-relation' && [view.objectType, view.actions], ['view', [{ type: 'set-options', options: { security_invoker: 'on' } }]]);
});

test('sql: views and materialized views with options', () => {
  const v = command('create or replace view public.safe with (security_invoker = true, security_barrier) as select 1;');
  assert.deepEqual(v.kind === 'create-view' && [v.name, v.orReplace, v.options], [{ schema: 'public', name: 'safe' }, true, { security_invoker: 'true', security_barrier: 'true' }]);
  const mv = command('create materialized view if not exists stats as select count(*) from t;');
  assert.equal(mv.kind === 'create-view' && mv.materialized, true);
});

test('sql: create policy with a quoted name, roles, and expressions', () => {
  const p = command(
    'create policy "Users can update their own profile." on public.profiles as permissive for update to authenticated, "anon" using ((select auth.uid()) = id) with check (true);',
  );
  assert.equal(p.kind, 'create-policy');
  if (p.kind !== 'create-policy') return;
  assert.equal(p.name, 'Users can update their own profile.');
  assert.deepEqual(p.table, { schema: 'public', name: 'profiles' });
  assert.equal(p.command, 'update');
  assert.equal(p.permissive, true);
  assert.deepEqual(p.roles, ['authenticated', 'anon']);
  assert.equal(expressionText(p.using), '(select auth.uid()) = id');
  assert.equal(expressionText(p.withCheck), 'true');
  const r = command('create policy deny on t as restrictive using (false);');
  assert.equal(r.kind === 'create-policy' && r.permissive, false);
  const plain = command('create policy p on t using (true);');
  assert.deepEqual(plain.kind === 'create-policy' && [plain.command, plain.roles], ['all', null]);
  // Not valid Postgres, but written by agents: the intended policy is still recognized.
  const ifNotExists = command('create policy if not exists "Uploads" on storage.objects for insert with check (true);');
  assert.deepEqual(ifNotExists.kind === 'create-policy' && [ifNotExists.name, ifNotExists.command], ['Uploads', 'insert']);
});

test('sql: alter and drop policy', () => {
  const a = command('alter policy "p" on public.t to authenticated using (owner = auth.uid());');
  assert.deepEqual(a.kind === 'alter-policy' && [a.name, a.roles, expressionText(a.using)], ['p', ['authenticated'], 'owner = auth.uid()']);
  const d = command('drop policy if exists "p" on storage.objects;');
  assert.deepEqual(d, { kind: 'drop-policy', name: 'p', table: { schema: 'storage', name: 'objects' } });
});

test('sql: drops, grants, revokes, and default privileges', () => {
  assert.deepEqual(command('drop table if exists a, public.b cascade;'), {
    kind: 'drop-relation',
    objectType: 'table',
    names: [
      { schema: null, name: 'a' },
      { schema: 'public', name: 'b' },
    ],
  });
  assert.deepEqual(command('revoke all on table public.secrets from anon, authenticated;'), {
    kind: 'revoke',
    privileges: ['all'],
    tables: [{ schema: 'public', name: 'secrets' }],
    schemas: [],
    roles: ['anon', 'authenticated'],
  });
  assert.deepEqual(command('grant select, insert on all tables in schema public to anon;'), {
    kind: 'grant',
    privileges: ['select', 'insert'],
    tables: [],
    schemas: ['public'],
    roles: ['anon'],
  });
  assert.deepEqual(command('grant select (id, name) on users to anon;'), { kind: 'grant', privileges: [], tables: [{ schema: null, name: 'users' }], schemas: [], roles: ['anon'] });
  assert.deepEqual(command('alter default privileges in schema public revoke all on tables from anon, authenticated;'), {
    kind: 'default-privileges',
    action: 'revoke',
    schemas: ['public'],
    privileges: ['all'],
    roles: ['anon', 'authenticated'],
  });
  assert.equal(command('grant usage on schema api to anon;').kind, 'other');
});

test('sql: search_path from SET and from pg_dump set_config', () => {
  assert.deepEqual(command('set search_path to app, public;'), { kind: 'set-search-path', schemas: ['app', 'public'] });
  assert.deepEqual(command("SELECT pg_catalog.set_config('search_path', '', false);"), { kind: 'set-search-path', schemas: [] });
});

test('sql: statements inside DO blocks and EXECUTE strings', () => {
  const sql = [
    'do $$',
    'begin',
    "  if not exists (select 1 from pg_policies where policyname = 'read all') then",
    '    create policy "read all" on public.posts for select using (true);',
    '  end if;',
    "  execute 'alter table public.posts enable row level security';",
    'end',
    '$$;',
  ].join('\n');
  const scan = scanSqlFile(sql);
  const inner = scan.commands.filter((c) => c.context === 'do');
  assert.deepEqual(
    inner.map((c) => [c.line, c.command.kind]),
    [
      [4, 'create-policy'],
      [6, 'alter-relation'],
    ],
  );
  assert.deepEqual(scan.dynamicRls, []);
});

test('sql: dynamic row level security in DO blocks and functions', () => {
  const sql = [
    'do $$ declare t record; begin',
    "  for t in select tablename from pg_tables where schemaname = 'public' loop",
    "    execute format('alter table public.%I enable row level security', t.tablename);",
    '  end loop;',
    'end $$;',
    'create function rls_on_create() returns event_trigger language plpgsql as $fn$',
    'begin',
    "  execute 'alter table ' || tg_table_name || ' enable row level security';",
    'end $fn$;',
    'create event trigger ensure_rls on ddl_command_end execute function rls_on_create();',
  ].join('\n');
  const scan = scanSqlFile(sql);
  assert.deepEqual(
    scan.dynamicRls.map((d) => [d.line, d.context]),
    [
      [3, 'do'],
      [8, 'function'],
    ],
  );
  const fn = scan.commands.find((c) => c.command.kind === 'create-function');
  assert.equal(fn?.command.kind === 'create-function' && fn.command.eventTrigger, true);
  const trigger = scan.commands.find((c) => c.command.kind === 'create-event-trigger');
  assert.equal(trigger?.command.kind === 'create-event-trigger' && trigger.command.functionName?.name, 'rls_on_create');
});

test('sql: expression text drops casts and normalizes spacing', () => {
  const text = (e: string) => expressionText(tokenizeSql(e));
  assert.equal(text("((bucket_id)::text = 'avatars'::text)"), "((bucket_id) = 'avatars')");
  assert.equal(text('auth.uid()  IS NOT NULL'), 'auth.uid() is not null');
  assert.equal(text("(storage.foldername(name))[1] = auth.uid()::text"), '(storage.foldername(name))[1] = auth.uid()');
  assert.equal(text("x::character varying = 'a'"), "x = 'a'");
  assert.equal(formatName({ schema: 'public', name: 'User Data' }), 'public."User Data"');
});
