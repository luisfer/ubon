# hono-workers-api

A Hono API on Cloudflare Workers with Drizzle and Neon.

| Problem | File |
| --- | --- |
| `sql.raw()` with a query parameter | `src/routes/posts.ts` |
| CORS that reflects any origin with credentials | `src/index.ts` |
| `decode()` of a JWT used for authorization, without verifying it | `src/auth.ts` |
| `Math.random()` for invite codes | `src/routes/invites.ts` |

The `sql` template with `${author}` next to it is safe, because Drizzle sends the value as a parameter, and must not be reported. `fixed/` uses the template for the search, verifies the JWT, allows one configured origin, and uses `crypto.randomUUID()`. `EXPECTED.json` lists every finding with its rule and line.
