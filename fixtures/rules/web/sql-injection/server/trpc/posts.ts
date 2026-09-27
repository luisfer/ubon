import { z } from 'zod';
import { publicProcedure, router } from './trpc';

export const postsRouter = router({
  search: publicProcedure.input(z.object({ term: z.string(), limit: z.number() })).query(async ({ input, ctx }) => {
    return ctx.db.$queryRawUnsafe(`SELECT * FROM posts WHERE title ILIKE '%${input.term}%' LIMIT ${input.limit}`); // expect: web/sql-injection
  }),
  latest: publicProcedure.input(z.object({ limit: z.number().int().max(50) })).query(async ({ input, ctx }) => {
    return ctx.db.$queryRawUnsafe(`SELECT * FROM posts ORDER BY created_at DESC LIMIT ${input.limit}`); // ok: z.number() field
  }),
});
