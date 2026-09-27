import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { type Env, requireUser } from '../auth';
import { getDb } from '../db/client';
import { posts } from '../db/schema';

export const postRoutes = new Hono<Env>();

postRoutes.get('/', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  return c.json(await db.select().from(posts).orderBy(desc(posts.createdAt)).limit(20));
});

postRoutes.get('/search', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const q = c.req.query('q') ?? '';
  const rows = await db.execute(sql.raw(`select id, title from posts where title ilike '%${q}%' limit 20`));
  return c.json(rows);
});

postRoutes.get('/by-author', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const author = Number(c.req.query('author'));
  const rows = await db.execute(sql`select id, title from posts where author_id = ${author} limit 20`);
  return c.json(rows);
});

postRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [post] = await db.select().from(posts).where(eq(posts.id, Number(c.req.param('id'))));
  return post ? c.json(post) : c.json({ error: 'not found' }, 404);
});

postRoutes.post('/', requireUser, async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { title, body } = await c.req.json<{ title: string; body: string }>();
  const [post] = await db.insert(posts).values({ authorId: c.get('userId'), title, body }).returning();
  return c.json(post, 201);
});
