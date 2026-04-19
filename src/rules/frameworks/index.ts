import { Rule, RuleMeta } from '../types';

const make = (meta: RuleMeta, fileTypes?: string[]): Rule => ({
  meta,
  impl: {
    fileTypes: fileTypes || ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'svelte', 'astro']
  }
});

/**
 * Modern framework rule pack — Next 14/15 Server Actions, Edge runtime,
 * SvelteKit, Astro, Remix, Hono, Drizzle and Prisma. Detection lives in
 * `FrameworkScanner` (regex/heuristic, not full AST). Metadata is centralised
 * here so `ubon explain <id>` works for every rule.
 */
export const frameworkRules: Record<string, Rule> = {
  // ---- Next.js Server Actions (App Router 14/15) -----------------------
  NEXT212: make({
    id: 'NEXT212',
    category: 'security',
    severity: 'high',
    message: 'Server Action exported without an auth check',
    fix: 'Call `auth()` / `getServerSession()` (or your equivalent) at the top of every exported Server Action and throw on missing session.',
    impact:
      "A Server Action is a public POST endpoint. Without an auth check it can be invoked by any visitor — even ones who never rendered the page that uses it.",
    helpUri:
      'https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#authentication-and-authorization'
  }),
  NEXT213: make({
    id: 'NEXT213',
    category: 'security',
    severity: 'high',
    message: 'Server Action accepts FormData / JSON without input validation',
    fix: 'Parse args through zod/valibot/yup before touching the database.',
    impact:
      'Server Actions accept arbitrary client payloads; missing validation lets attackers smuggle unexpected fields into your ORM (mass assignment).',
    helpUri:
      'https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#validation'
  }),
  NEXT214: make({
    id: 'NEXT214',
    category: 'security',
    severity: 'high',
    message: '`use server` module imported from a `use client` file',
    fix: 'Call Server Actions through the Action object or via a server component prop. Never import the action module directly into client code.',
    impact:
      'Direct imports leak server-only code (DB clients, secrets) into the client bundle.',
    helpUri: 'https://react.dev/reference/rsc/use-server'
  }),
  NEXT215: make({
    id: 'NEXT215',
    category: 'security',
    severity: 'high',
    message: 'Server Action passes user input directly to redirect()/revalidatePath()',
    fix: 'Validate the path against an allowlist before redirect()/revalidatePath().',
    impact:
      'Open redirects and arbitrary cache invalidations can be triggered by any unauthenticated visitor.',
    helpUri:
      'https://nextjs.org/docs/app/api-reference/functions/redirect'
  }),
  NEXT216: make({
    id: 'NEXT216',
    category: 'security',
    severity: 'high',
    message: 'App Router page/layout types `params`/`searchParams` as a plain object (Next 15 requires a Promise)',
    fix: 'Type the prop as `Promise<{ ... }>` and `await` it before use. Example: `export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; }`.',
    impact:
      'In Next 15 `params` and `searchParams` are asynchronous. A synchronous object type compiles but returns a thenable at runtime, so field access silently yields `undefined` (or crashes under strict typing).',
    helpUri:
      'https://nextjs.org/docs/app/api-reference/file-conventions/page#params-optional'
  }, ['ts', 'tsx']),
  NEXT217: make({
    id: 'NEXT217',
    category: 'security',
    severity: 'high',
    message: "React hook used in a component file without the `'use client'` directive",
    fix: "Add `'use client';` at the very top of the file (above the imports).",
    impact:
      "Using `useState`/`useEffect`/etc. in a Server Component fails the Next build. Without `'use client'`, the file is treated as server-side and the hook import throws at compile time.",
    helpUri:
      'https://nextjs.org/docs/app/building-your-application/rendering/client-components'
  }, ['tsx', 'jsx']),
  NEXT218: make({
    id: 'NEXT218',
    category: 'security',
    severity: 'low',
    message: '`reactStrictMode: false` disables an important dev-time correctness check',
    fix: 'Remove the override or set `reactStrictMode: true`. Strict mode surfaces unsafe side-effects and legacy lifecycles while developing.',
    impact:
      'Disabling Strict Mode masks double-invocation bugs and deprecated API warnings that Next would otherwise catch during `next dev`.',
    helpUri: 'https://react.dev/reference/react/StrictMode'
  }, ['js', 'ts', 'mjs', 'cjs']),
  NEXT219: make({
    id: 'NEXT219',
    category: 'security',
    severity: 'low',
    message: '`experimental.serverActions: true` is the Next 13 shape and is ignored in Next 14/15',
    fix: 'Remove the flag. Server Actions are stable since Next 14; the boolean form no longer applies. Use `experimental.serverActions = { allowedOrigins, bodySizeLimit }` only if you need the object form.',
    impact:
      'Stale experimental flags give a false sense that something is configured. Keeping the boolean shape masks the fact that no tuning is actually in place.',
    helpUri: 'https://nextjs.org/docs/app/api-reference/next-config-js/serverActions'
  }, ['js', 'ts', 'mjs', 'cjs']),

  // ---- Edge runtime ----------------------------------------------------
  EDGE001: make({
    id: 'EDGE001',
    category: 'security',
    severity: 'high',
    message: 'Node-only API used in `runtime = "edge"` route',
    fix: 'Remove the `fs` / `child_process` / `crypto.createHash` import or switch the route to `runtime = "nodejs"`.',
    impact:
      'Deploys silently break at runtime in production; Vercel/Cloudflare swallow the import error and serve a generic 500.',
    helpUri:
      'https://nextjs.org/docs/app/building-your-application/rendering/edge-and-nodejs-runtimes'
  }),
  EDGE002: make({
    id: 'EDGE002',
    category: 'security',
    severity: 'medium',
    message: 'Long-lived response in edge runtime without streaming',
    fix: 'Return a `ReadableStream` (or use `streamText`) so the runtime can keep the connection open without hitting the 25s/30s wall-clock cap.',
    impact:
      'Edge handlers are killed after ~25–30s; non-streaming LLM calls regularly hit this limit.'
  }),
  EDGE003: make({
    id: 'EDGE003',
    category: 'security',
    severity: 'medium',
    message: '`process.env.X` read at module top-level inside edge route',
    fix: 'Read the env var inside the request handler. Top-level reads are baked at build time and may snapshot stale values across deploys.',
    impact:
      'Edge bundles freeze top-level `process.env` reads; rotating a secret will not take effect until the next build.'
  }),

  // ---- SvelteKit -------------------------------------------------------
  SVELTE001: make({
    id: 'SVELTE001',
    category: 'security',
    severity: 'high',
    message: 'SvelteKit `+page.server.ts` returns env/secret in `load` data',
    fix: 'Strip env vars and secrets from the load() return value; only return DTOs the page needs.',
    impact:
      "Anything returned from a server `load()` is serialised into the page's HTML and visible in the browser.",
    helpUri: 'https://kit.svelte.dev/docs/load'
  }, ['ts', 'js']),
  SVELTE002: make({
    id: 'SVELTE002',
    category: 'security',
    severity: 'high',
    message: 'SvelteKit form action without CSRF/auth verification',
    fix: 'Use the built-in `event.locals.user` check or `event.request.formData()` with origin verification.',
    impact: 'Form actions are POST endpoints; missing auth = mass assignment + IDOR.',
    helpUri: 'https://kit.svelte.dev/docs/form-actions'
  }, ['ts', 'js']),

  // ---- Astro -----------------------------------------------------------
  ASTRO001: make({
    id: 'ASTRO001',
    category: 'security',
    severity: 'high',
    message: 'Astro server endpoint without auth check',
    fix: 'Validate `Astro.locals.user` (or your auth helper) before mutating data in `POST`/`PUT`/`DELETE`.',
    impact: 'Astro `endpoint.ts` files are unauthenticated by default.',
    helpUri: 'https://docs.astro.build/en/core-concepts/endpoints/'
  }, ['ts', 'js', 'astro']),

  // ---- Remix -----------------------------------------------------------
  REMIX001: make({
    id: 'REMIX001',
    category: 'security',
    severity: 'high',
    message: 'Remix `action`/`loader` accesses DB without session check',
    fix: 'Call `requireUserId(request)` or your equivalent at the top of every action/loader that mutates data.',
    impact: 'Loaders and actions are public endpoints; missing auth leaks data and allows mutations.',
    helpUri: 'https://remix.run/docs/en/main/guides/authentication'
  }, ['ts', 'js', 'tsx', 'jsx']),

  // ---- Hono ------------------------------------------------------------
  HONO001: make({
    id: 'HONO001',
    category: 'security',
    severity: 'medium',
    message: 'Hono route reads body without validator middleware',
    fix: "Wrap the route with `zValidator('json', schema)` (or your validator) before consuming `c.req.json()`.",
    impact: 'Unvalidated bodies feed unsafe values into your handlers.',
    helpUri: 'https://hono.dev/guides/validation'
  }, ['ts', 'js', 'tsx', 'jsx', 'mjs', 'cjs']),

  // ---- Drizzle / Prisma -----------------------------------------------
  DRIZZLE001: make({
    id: 'DRIZZLE001',
    category: 'security',
    severity: 'high',
    message: "Drizzle `sql\`\`` template includes interpolated user input",
    fix: 'Use Drizzle helpers (`eq`, `and`, `inArray`) or `sql.placeholder` instead of raw interpolation.',
    impact: 'Raw SQL interpolation is the classic SQL injection vector.',
    helpUri: 'https://orm.drizzle.team/docs/sql'
  }, ['ts', 'js', 'tsx', 'jsx']),
  PRISMA001: make({
    id: 'PRISMA001',
    category: 'security',
    severity: 'high',
    message: 'Prisma `$queryRawUnsafe` / `$executeRawUnsafe` with untrusted input',
    fix: 'Use `$queryRaw` (tagged template) with parameterised inputs, or wrap with Prisma\'s native query builders.',
    impact: 'The `Unsafe` variants concatenate strings — direct SQL injection sink.',
    helpUri: 'https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access'
  }, ['ts', 'js', 'tsx', 'jsx'])
};
