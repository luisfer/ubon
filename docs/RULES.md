# Rules Glossary

This file is auto-generated from the rule registry by `scripts/generate-rules-md.js`.
Do not hand-edit; run `npm run rules:gen` after building.

Total rules: **152**.

## Security (JS/TS)

- **COOKIE001** — Set-Cookie missing HttpOnly/Secure/SameSite ([docs](https://owasp.org/www-community/controls/SecureCookieAttributes))
- **COOKIE002** — JWT token exposed in client-side cookie without security flags ([docs](https://owasp.org/www-community/controls/SecureCookieAttributes))
- **COOKIE003** — Sensitive data returned in JSON response (potential token leak)
- **COOKIE004** — Cookie used without domain/path restrictions
- **JSNET001** — HTTP request without timeout/retry policy ([docs](https://developer.mozilla.org/docs/Web/API/AbortController))
- **LOG001** — Potential secret logged to console/logger ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html))
- **OSV001** — Vulnerable dependency detected
- **SEC001** — Potential API key or secret token exposed ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html))
- **SEC002** — Supabase URL hardcoded (should use env var)
- **SEC003** — Supabase anon key hardcoded (JWT token pattern)
- **SEC004** — Supabase URL hardcoded in variable
- **SEC005** — Supabase key hardcoded in variable
- **SEC006** — Hardcoded password detected
- **SEC007** — Database URL hardcoded
- **SEC008** — Environment variable with hardcoded fallback
- **SEC009** — AWS Access Key ID exposed
- **SEC010** — Google OAuth token exposed
- **SEC011** — GitHub token exposed
- **SEC012** — Stripe live secret key exposed
- **SEC013** — Stripe live publishable key exposed
- **SEC014** — OpenAI API key exposed ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html))
- **SEC015** — Console statement found (may leak sensitive info)
- **SEC016** — Use of eval() detected (security risk) ([docs](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/eval))
- **SEC017** — dangerouslySetInnerHTML usage (XSS risk) ([docs](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html))
- **SEC018** — High-entropy string literal (possible secret) ([docs](https://owasp.org/Top10/A02_2021-Cryptographic_Failures))
- **SEC019** — React component injection via createElement
- **SEC020** — SQL sink called with string interpolation or concatenation (SQL injection) ([docs](https://owasp.org/Top10/A03_2021-Injection))
- **SEC021** — Error stack / internal error serialised into HTTP response body ([docs](https://owasp.org/www-community/Improper_Error_Handling))
- **SEC022** — Silent `.catch(() => [] | {} | null)` after DB/fetch — swallows errors and returns stub data
- **SEC023** — Weak hash (`md5` / `sha1`) used for a password / token ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html))
- **SEC024** — `Math.random()` used to produce a token / session id / nonce ([docs](https://developer.mozilla.org/docs/Web/API/Crypto/randomUUID))
- **SEC025** — Open redirect: `redirect()` / `router.push()` / `NextResponse.redirect()` fed directly from user input ([docs](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet))
- **SEC026** — `child_process.exec` / `execSync` / `spawn` called with a string containing user input ([docs](https://owasp.org/Top10/A03_2021-Injection))
- **SEC027** — File path built from user input without a path-traversal guard ([docs](https://owasp.org/www-community/attacks/Path_Traversal))
- **SEC028** — Auth token stored in `localStorage` / `sessionStorage` ([docs](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage))
- **SEC029** — Webhook route handler never verifies an incoming signature before mutating state ([docs](https://stripe.com/docs/webhooks/signatures))
- **SEC030** — fetch() target is user-controlled in a server route — potential SSRF ([docs](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery))
- **SEC031** — Password/token compared with `===` / `!==` instead of a timing-safe compare ([docs](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b))

## AI (LLM era)

- **AI001** — LLM provider API key hardcoded ([docs](https://platform.openai.com/docs/guides/production-best-practices/api-keys))
- **AI002** — User input flows into an LLM prompt without isolation (prompt injection sink) ([docs](https://owasp.org/www-project-top-10-for-large-language-model-applications/))
- **AI003** — System prompt or LLM config defined in client-side code ([docs](https://owasp.org/www-project-top-10-for-large-language-model-applications/))
- **AI004** — Vector database API key hardcoded
- **AI005** — MCP server configuration contains hardcoded secret ([docs](https://modelcontextprotocol.io/docs/concepts/configuration))
- **AI006** — LLM tool/function handler missing auth or capability allowlist ([docs](https://owasp.org/www-project-top-10-for-large-language-model-applications/))
- **AI007** — LLM streaming endpoint missing auth and/or rate limiting ([docs](https://vercel.com/docs/security/ddos-mitigation))
- **AI008** — LLM call without max_tokens / input length guard (cost-amplification risk)

## Next.js

- **NEXT001** — next/link used without anchor or child text (legacyBehavior)
- **NEXT002** — In-page <a> used for client navigation; prefer next/link
- **NEXT003** — Next.js API route uses request params without validation
- **NEXT004** — Dynamic import with user-controlled path
- **NEXT005** — External <img> used in Next.js app (consider next/image)
- **NEXT006** — Sensitive data exposed via getStaticProps/getServerSideProps
- **NEXT007** — JWT token exposed in Next.js API response
- **NEXT008** — Missing security headers in Next.js API route
- **NEXT009** — Unsafe redirect in Next.js API route ([docs](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet))
- **NEXT010** — CORS configuration too permissive ([docs](https://developer.mozilla.org/docs/Web/HTTP/CORS))
- **NEXT011** — Environment variable leaked in client-side code ([docs](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser))
- **NEXT210** — Server secret serialized to client props (leak risk) ([docs](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props#caveats))
- **NEXT212** — Server Action exported without an auth check ([docs](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#authentication-and-authorization))
- **NEXT213** — Server Action accepts FormData / JSON without input validation ([docs](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#validation))
- **NEXT214** — `use server` module imported from a `use client` file ([docs](https://react.dev/reference/rsc/use-server))
- **NEXT215** — Server Action passes user input directly to redirect()/revalidatePath() ([docs](https://nextjs.org/docs/app/api-reference/functions/redirect))
- **NEXT216** — App Router page/layout types `params`/`searchParams` as a plain object (Next 15 requires a Promise) ([docs](https://nextjs.org/docs/app/api-reference/file-conventions/page#params-optional))
- **NEXT217** — React hook used in a component file without the `'use client'` directive ([docs](https://nextjs.org/docs/app/building-your-application/rendering/client-components))
- **NEXT218** — `reactStrictMode: false` disables an important dev-time correctness check ([docs](https://react.dev/reference/react/StrictMode))
- **NEXT219** — `experimental.serverActions: true` is the Next 13 shape and is ignored in Next 14/15 ([docs](https://nextjs.org/docs/app/api-reference/next-config-js/serverActions))
- **NEXT220** — `typeof window !== "undefined"` / `window.*` access inside a Server Component ([docs](https://nextjs.org/docs/app/building-your-application/rendering/server-components))
- **NEXT221** — Client Component imports a server-only module (`fs`, `child_process`, `pg`, `better-sqlite3`, `@prisma/client`, …) ([docs](https://nextjs.org/docs/app/building-your-application/rendering/client-components))
- **NEXT222** — Server Component imports a client-only state library (`zustand` / `jotai` / `recoil` / `valtio`) ([docs](https://react.dev/reference/rsc/use-client))
- **NEXT223** — `app/**/route.ts` uses `export default` instead of a named `GET`/`POST`/… export ([docs](https://nextjs.org/docs/app/building-your-application/routing/route-handlers))
- **NEXT224** — `<a href="/internal">` used instead of `<Link>` for an internal route ([docs](https://nextjs.org/docs/app/api-reference/components/link))
- **NEXT225** — `<form method="POST" action="/api/…">` without a CSRF token or a Server Action ([docs](https://owasp.org/www-community/attacks/csrf))

## Next.js (experimental)

- **NEXT201** — Missing 404/not-found page ([docs](https://nextjs.org/docs/app/api-reference/file-conventions/not-found))
- **NEXT202** — Missing error boundary page ([docs](https://nextjs.org/docs/app/building-your-application/routing/error-handling))
- **NEXT203** — Missing _document.tsx while using next/head or next/script ([docs](https://nextjs.org/docs/pages/building-your-application/routing/custom-document))
- **NEXT205** — API route may be accessible without authentication ([docs](https://next-auth.js.org/configuration/nextjs#api-routes))
- **NEXT208** — router.push() to external URL ([docs](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet))
- **NEXT209** — API route missing HTTP method validation ([docs](https://nextjs.org/docs/app/building-your-application/routing/route-handlers))

## Edge runtime

- **EDGE001** — Node-only API used in `runtime = "edge"` route ([docs](https://nextjs.org/docs/app/building-your-application/rendering/edge-and-nodejs-runtimes))
- **EDGE002** — Long-lived response in edge runtime without streaming
- **EDGE003** — `process.env.X` read at module top-level inside edge route

## Modern frameworks (SvelteKit, Astro, Remix, Hono, Drizzle, Prisma)

- **ASTRO001** — Astro server endpoint without auth check ([docs](https://docs.astro.build/en/core-concepts/endpoints/))
- **DRIZZLE001** — Drizzle `sql``` template includes interpolated user input ([docs](https://orm.drizzle.team/docs/sql))
- **HONO001** — Hono route reads body without validator middleware ([docs](https://hono.dev/guides/validation))
- **PRISMA001** — Prisma `$queryRawUnsafe` / `$executeRawUnsafe` with untrusted input ([docs](https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access))
- **REMIX001** — Remix `action`/`loader` accesses DB without session check ([docs](https://remix.run/docs/en/main/guides/authentication))
- **SVELTE001** — SvelteKit `+page.server.ts` returns env/secret in `load` data ([docs](https://kit.svelte.dev/docs/load))
- **SVELTE002** — SvelteKit form action without CSRF/auth verification ([docs](https://kit.svelte.dev/docs/form-actions))

## Lovable / Supabase

- **LOVABLE001** — Supabase table accessed without RLS policy validation ([docs](https://supabase.com/docs/guides/auth/row-level-security))
- **LOVABLE002** — Supabase credentials hardcoded in source code ([docs](https://vitejs.dev/guide/env-and-mode.html))
- **LOVABLE003** — Anonymous authentication enabled without RLS policy validation ([docs](https://supabase.com/docs/guides/auth/auth-anonymous))
- **LOVABLE004** — Potential SQL injection in Supabase query - uses string interpolation ([docs](https://supabase.com/docs/reference/javascript/using-filters))
- **LOVABLE005** — Weak RLS policy pattern detected ([docs](https://supabase.com/docs/guides/auth/row-level-security#policies))
- **LOVABLE006** — Supabase storage access without proper validation ([docs](https://supabase.com/docs/guides/storage/security/access-control))

## Vite

- **VITE001** — Environment variable without VITE_ prefix may expose secrets to client ([docs](https://vitejs.dev/guide/env-and-mode.html#env-variables))
- **VITE002** — Development-only code without production fallback ([docs](https://vitejs.dev/guide/env-and-mode.html#modes))
- **VITE003** — Unsafe dynamic import with user input - potential path traversal ([docs](https://vitejs.dev/guide/features.html#dynamic-import))

## React / Tailwind

- **REACT001** — Array index used as React `key` — breaks reconciliation on reorder/insert ([docs](https://react.dev/learn/rendering-lists#why-does-react-need-keys))
- **REACT002** — Event handler invoked at render time (`onClick={fn()}` instead of `onClick={fn}`) ([docs](https://react.dev/learn/responding-to-events))
- **REACT003** — State mutated in place before setter call (React will not re-render) ([docs](https://react.dev/learn/updating-arrays-in-state))
- **REACT004** — `useEffect(cb, [])` closes over a state value without listing it as a dependency ([docs](https://react.dev/learn/you-might-not-need-an-effect))
- **REACT005** — `useEffect` starts a timer / listener without returning a cleanup function ([docs](https://react.dev/reference/react/useEffect#subscribing-to-events))
- **REACT006** — `useEffect` issues `fetch` without an AbortController signal ([docs](https://react.dev/reference/react/useEffect#fetching-data-with-effects))
- **REACT007** — Async function passed directly to `useEffect` (returns a Promise, not a cleanup) ([docs](https://react.dev/reference/react/useEffect))
- **REACT008** — `useState(expensive())` runs the initializer on every render ([docs](https://react.dev/reference/react/useState#avoiding-recreating-the-initial-state))
- **REACT009** — React hook called conditionally (inside `if` / ternary / loop / early return) ([docs](https://react.dev/reference/rules/rules-of-hooks))
- **REACT010** — `ref.current = …` assigned during render ([docs](https://react.dev/reference/react/useRef#referencing-a-value-with-a-ref))
- **REACT011** — JWT / bearer token stored in `localStorage` / `sessionStorage` ([docs](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html))
- **TAILWIND001** — Dynamic className with unvalidated input - may allow CSS injection ([docs](https://tailwindcss.com/docs/content-configuration#dynamic-class-names))

## Vibe (AI hallucination signals)

- **VIBE001** — Import from non-existent package (possible hallucination)
- **VIBE002** — Repeated code block detected (possible copy-paste artifact)
- **VIBE003** — Incomplete implementation detected (placeholder or stub)
- **VIBE004** — Exported symbol appears unused in the codebase

## Development hygiene

- **DEV001** — TODO/FIXME comments detected
- **DEV002** — "Not implemented" stub found
- **DEV003** — Placeholder URL detected
- **DEV004** — Hardcoded mock/example data detected
- **DEV005** — Empty return or stubbed function detected

## Accessibility

- **A11Y001** — Image without alt attribute ([docs](https://webaim.org/techniques/alttext/))
- **A11Y002** — Input without label or aria-label ([docs](https://web.dev/labels-and-text-alternatives/))
- **A11Y003** — Empty button without aria-label ([docs](https://dequeuniversity.com/rules/axe/4.7/button-name))
- **A11Y004** — Div with onClick (not keyboard accessible) ([docs](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Roles/button_role))
- **A11Y005** — Link without href attribute ([docs](https://dequeuniversity.com/rules/axe/4.7/link-name))
- **A11Y006** — Image missing width/height attributes ([docs](https://web.dev/optimize-cls/))
- **A11Y007** — next/image used without width and height ([docs](https://nextjs.org/docs/pages/api-reference/components/image))

## Environment variables

- **ENV001** — .env file may not be in .gitignore
- **ENV002** — Potential API key in .env file
- **ENV004** — Secret value in .env file
- **ENV005** — Supabase credentials in .env
- **ENV006** — Missing .env.example file for documentation
- **ENV007** — Environment variable drift between .env and .env.example
- **ENV008** — Client-exposed env var carries a database/service connection URL (leaks to browser bundle) ([docs](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser))

## Links

- **LINK001** — Link checking requires puppeteer installation
- **LINK002** — External link unreachable or 4xx/5xx
- **LINK003** — Internal link or resource broken

## Docker / CI

- **DOCKER001** — Dockerfile runs as root (USER root or no USER)
- **DOCKER002** — Secrets defined via ENV in Dockerfile
- **DOCKER003** — Docker base image uses :latest tag
- **DOCKER004** — apt-get install without cleaning apt cache
- **GHA001** — Secrets may be echoed in GitHub Actions workflow

## Other

- **CC001** — Secret literal inside `.claude/settings*.json` ([docs](https://docs.claude.com/en/docs/claude-code/settings))
- **CC002** — Claude Code hook shell script uses unquoted variable in a destructive command (`rm`/`mv`/`cp`/`eval`) ([docs](https://www.shellcheck.net/wiki/SC2086))
- **CC003** — Claude Code hook executes `curl | sh` or pipes remote content to a shell ([docs](https://docs.claude.com/en/docs/claude-code/hooks))
- **CC004** — Secret-shaped string inside `CLAUDE.md` / `.claude/agents/*.md` ([docs](https://docs.claude.com/en/docs/claude-code/memory))
- **CC005** — MCP server config exposes a secret in its `env` block ([docs](https://modelcontextprotocol.io/docs/concepts/configuration))
- **CC006** — Secret-shaped string inside `.cursorrules` / `.cursor/rules/*.mdc` / `.windsurfrules` / `.aiderconfig`
- **CC007** — Claude Code session transcripts or TODO state committed to the repo ([docs](https://docs.claude.com/en/docs/claude-code/overview))
- **CC008** — Prompt-injection marker inside agent rules / memory file ([docs](https://simonwillison.net/2023/May/2/prompt-injection-explained/))
- **MOD001** — Module-level side effect (`fs.*Sync`, `db.exec`, `fetch`) runs at import time
- **MOD002** — `async function` body contains no `await` / `for await` (unnecessary wrapper)
- **MOD003** — Silent `.catch(() => …)` on a DB/fetch call hides real errors from the caller
- **MOD004** — High density of `: any` annotations in a single file
