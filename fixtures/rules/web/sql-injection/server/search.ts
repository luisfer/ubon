import Database from 'better-sqlite3';
import { Hono } from 'hono';
import knex from 'knex';
import postgres from 'postgres';

const app = new Hono();
const db = new Database('app.db');
const sql = postgres(process.env.DATABASE_URL ?? '');
const qb = knex({ client: 'pg' });

app.get('/search', async (c) => {
  const q = c.req.query('q');
  const stmt = db.prepare(`SELECT * FROM notes WHERE body LIKE '%${q}%'`); // expect: web/sql-injection
  const byId = db.prepare('SELECT * FROM notes WHERE id = ?').get(c.req.query('id')); // ok: placeholder
  const tagged = await sql`select * from notes where body = ${q}`; // ok: postgres.js tag parameterizes
  const unsafe = await sql.unsafe(`select * from notes where title = '${q}'`); // expect: web/sql-injection
  const bound = await qb.raw('select * from notes where title = ?', [q]); // ok: Knex raw with bindings
  const where = await qb('notes').whereRaw(`title = '${q}'`); // expect: web/sql-injection
  return c.json({ rows: stmt.all(), byId, tagged, unsafe, bound, where });
});

export default app;
