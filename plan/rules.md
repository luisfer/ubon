# Ubon 4 rule catalog (proposal)

This file specifies the rules Ubon 4 ships with, what each one detects, how it avoids false positives, and which v3 rules it replaces. It is the input for implementation: every rule listed here needs fixtures and a precision measurement before it can ship at the `block` level.

Back to the main plan: [README.md](README.md).

## How to read this catalog

### Rule IDs

Rule IDs use `pack/name` in kebab case, for example `web/ssrf` or `integrity/test-skipped`. IDs describe the problem, so an agent reading `// ubon-ignore web/ssrf: ...` understands the suppression without looking anything up. Short numeric codes (`SEC030`) are gone.

### Levels

| Level | Meaning in the agent loop | Meaning in CI |
| --- | --- | --- |
| `block` | The agent is told to fix it before it finishes (Stop hook) or the action is denied (PreToolUse hook). | Exit code 1. |
| `warn` | Reported to the agent as context. Never stops it. | Reported, exit code 0. |
| `off` | Not run. | Not run. |

There are no confidence scores. A rule is either precise enough to block, or it warns. The measured precision of every rule is published in `docs/precision.md`, generated from the corpus (see [README.md, testing](README.md#10-testing-examples-and-evidence)).

### Scope

The scope says where the rule looks:

- `file`: one file at a time (fast, runs after every edit).
- `project`: needs several files (package.json, lockfile, migrations, the client module graph).
- `diff`: compares the base version with the current version (merge base in CI, session start in an agent session).
- `hook`: runs on an agent's hook payload (a shell command, a prompt, a tool output) instead of on files.

### File contexts

Ubon computes these before running rules, because most false positives in v3 came from not knowing them:

| Context | How it is determined |
| --- | --- |
| `client` | Files with `'use client'`, plus every module they import transitively (the client module graph), Vite/SPA source under `src/` when there is no server entry, `.svelte`/`.vue`/`.astro` client script blocks. |
| `server` | Route handlers, Server Actions (`'use server'`), `middleware.ts`/`proxy.ts`, `+server.ts`, `+page.server.ts`, `*.server.ts`, Remix/React Router `loader`/`action`, Hono/Express/Fastify route registrations, files importing `server-only`. |
| `test` | `*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `tests/`, `e2e/`, Playwright/Cypress/Vitest config. |
| `config` | Build and tool config (`next.config.*`, `vite.config.*`, `tsconfig.json`, `eslint.config.*`, `jest.config.*`, `vitest.config.*`, workflow files). |
| `generated` | Lockfiles, `*.d.ts`, minified files, `dist/`, `.next/`, anything with an `@generated` header. Only `deps/*` rules read lockfiles. |
| `agent` | Agent instruction and config files: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/**`, `.cursor/**`, `.codex/**`, `.gemini/**`, `.github/copilot-instructions.md`, `.github/instructions/**`, `SKILL.md`, `.mcp.json`, `.vscode/mcp.json`, `.windsurf/**`, `.clinerules`, `.kiro/**`. |
| `migration` | `supabase/migrations/*.sql`, `supabase/schemas/*.sql`, `prisma/migrations/**/migration.sql`, `drizzle/*.sql`, Firebase rules files. |

### Milestones

`4.0` ships in the first stable release. `4.1` and `4.2` follow. See the roadmap in the main plan.

## The `secret` pack

Secrets in code, config, agent files, prompts, and tool output. Secret values never appear in any Ubon output: evidence is masked when the finding is created, so the raw value cannot reach JSON, SARIF, MCP responses, hook output, caches, or logs.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `secret/provider-key` | block | file | A literal credential in a known provider format: OpenAI (`sk-proj-`, `sk-svcacct-`, `sk-admin-`), Anthropic (`sk-ant-`), Google (`AIza`), AWS (`AKIA`/`ASIA` plus secret), GitHub (`ghp_`, `gho_`, `ghs_`, `ghu_`, `ghr_`, `github_pat_`), GitLab (`glpat-`), Stripe live keys and `whsec_`, Slack tokens and webhook URLs, SendGrid, Resend, npm (`npm_`), PyPI, Hugging Face (`hf_`), Replicate (`r8_`), Groq (`gsk_`), xAI, OpenRouter, Pinecone (`pcsk_`), Supabase secret keys (`sb_secret_`, `sbp_`, legacy JWTs whose payload has `role: service_role`), Telegram bot tokens, PEM private keys, Firebase service account JSON. Applies to every text file, including Markdown, notebooks, and agent files. | Placeholder detection (`xxxx`, `your-key-here`, `EXAMPLE`, repeated characters, `<...>`, `${VAR}`), known documentation keys (AWS `AKIAIOSFODNN7EXAMPLE`), lockfiles and `generated` files skipped. Test keys (`sk_test_`) are reported as `warn`. Public-by-design keys (`sb_publishable_`, Supabase anon JWTs, Stripe `pk_`, Firebase web `apiKey`) are not secrets and are not reported here; the risk they carry is covered by `data/*`. Patterns adapted from gitleaks and Betterleaks (both MIT) with attribution and fixtures per provider. Semgrep registry rules are not used: their license forbids use in competing products. | SEC001, SEC003, SEC005, SEC006, SEC009 to SEC014, AI001, AI004, AI005, CC001, CC004, CC005, CC006, LOVABLE002, ENV002, ENV004 | 4.0 |
| `secret/db-url-password` | block | file | Connection strings with an inline password (`postgres://user:pass@host`, `mongodb+srv://`, `mysql://`, `redis://:pass@`). | Hosts `localhost`, `127.0.0.1`, `db`, `postgres` (docker compose service names) and passwords like `postgres`, `password`, `example` are `warn`. `${VAR}` interpolation ignored. | SEC007 | 4.0 |
| `secret/public-env-name` | block | file | An env var that the framework exposes to the browser but whose name says it is secret: `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `EXPO_PUBLIC_`, `NUXT_PUBLIC_`, `REACT_APP_`, `GATSBY_` combined with `SECRET`, `PRIVATE`, `SERVICE_ROLE`, `PASSWORD`, `DATABASE_URL`, or a server-only provider key name (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, ...). Checked in `.env*` files, code (`process.env.X`, `import.meta.env.X`), `vercel.json`, `netlify.toml`, and CI env blocks. This is the most common agent "fix" when a server variable is undefined in the browser. | Names containing `PUBLISHABLE`, `ANON`, `PUBLIC_KEY`, `SITE_KEY`, `MEASUREMENT_ID` are allowed. | ENV008, VITE001, NEXT011 | 4.0 |
| `secret/env-file-committed` | block | project | A `.env`, `.env.local`, `.env.production` (or similar) file that is tracked by git or newly added in the diff and holds non-placeholder values. | `.env.example`, `.env.sample`, `.env.template`, and files whose values are all empty or placeholders are allowed. Uses `git ls-files`, so an ignored local `.env` is never reported. | ENV001, ENV002, ENV004, ENV005 | 4.0 |
| `secret/key-file-committed` | block | project | Private key and credential files tracked by git: `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`, `.npmrc` or `.yarnrc.yml` with a literal auth token, `.pypirc`, cloud service account JSON. | Public certificates (`BEGIN CERTIFICATE`) and `.pub` files are allowed. | none | 4.0 |
| `secret/server-env-in-client` | warn | project | `process.env.X` without a public prefix read in a `client` module. The value is `undefined` in the browser, and the usual follow-up mistake is renaming it with `NEXT_PUBLIC_`. The message says to move the call to a server route or action instead. | `NODE_ENV` and framework-injected variables allowed. Requires the client module graph. | NEXT011 (partly) | 4.0 |
| `secret/sent-to-client` | warn | file | A secret-named server env value placed in data that crosses to the browser: returned from `getServerSideProps`/`load`/`loader`, passed as a prop from a Server Component to a client component, or returned in a JSON response. | Only secret-named variables (same name list as `secret/public-env-name`). | NEXT006, NEXT210, SVELTE001 | 4.1 |
| `secret/logged` | warn | file | Secret-named values passed to `console.*` or common loggers (`pino`, `winston`, `consola`). | Redaction helpers recognized (`redact(`, `mask(`). | LOG001 | 4.1 |
| `secret/in-prompt` | block | hook | A provider key pasted into a user prompt (Claude Code `UserPromptSubmit`, Cursor `beforeSubmitPrompt`, equivalents elsewhere). Blocking keeps the key out of the transcript and out of the model provider's logs. The message tells the user to put the key in `.env` and refer to it by name. | Only `secret/provider-key` formats, never generic entropy. Configurable to `warn`. | none (v3 hook was a no-op) | 4.0 |
| `secret/in-tool-output` | warn | hook | Shell or MCP tool output that contains a provider key. The agent is told not to repeat it and to suggest rotation. | Same formats as above. | none | 4.0 |
| `secret/read-sensitive-file` | block (ask) | hook | The agent tries to read `.env*`, `*.pem`, `~/.ssh/*`, `~/.aws/credentials`, `~/.npmrc`, `~/.config/gh/hosts.yml` through a read tool or `cat`/`less`/`head`. Returns `ask` where the agent supports it, so the human decides whether the secret enters the model context. | `.env.example` and friends allowed. Project allowlist in `ubon.json`. | none | 4.0 |

## The `web` pack

Server-side and browser security at trust boundaries. Taint tracking is intra-procedural and deliberately simple: sources are request data (`req.body`, `req.query`, `req.params`, `await request.json()`, `formData`, `searchParams`, `params`, `headers()`, `cookies()`, Server Action arguments, tool arguments supplied by a model), followed through local `const`/`let` bindings and destructuring. A finding always shows the path from source to sink so a human or an agent can check it.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `web/sql-injection` | block | file | Request-derived values concatenated or interpolated into raw SQL APIs: Prisma `$queryRawUnsafe`/`$executeRawUnsafe`, Drizzle `sql.raw()`, postgres.js `sql.unsafe()`, Knex `raw()` with `${}`, `pg`/`mysql2` `query()` with a template or `+`, better-sqlite3 `prepare()`/`exec()` with a template, Sequelize `query()`. | Tagged templates that parameterize (`` sql`...${x}` `` in Drizzle, postgres.js, and `@vercel/postgres`; Prisma `` $queryRaw`...` ``) are safe and never reported. v3 DRIZZLE001 flagged exactly this safe form. Constants and numeric casts are not tainted. | SEC020, PRISMA001, DRIZZLE001, LOVABLE004 | 4.0 |
| `web/command-injection` | block | file | `exec`, `execSync`, `spawn`/`execa` with `shell: true`, or `child_process` calls whose command string contains request-derived or model-derived data. | `execFile`/`spawn` with an argument array and no shell are safe. Receivers that are database clients (`db.exec`) are excluded (that is `web/sql-injection`). | SEC026 | 4.0 |
| `web/ssrf` | block | file | Server-side `fetch`, `axios`, `got`, `ky`, `undici`, `http.get` whose URL is request-derived or model-derived. | Allowlist checks recognized (`new URL(x)` followed by a hostname comparison, `allowedHosts.includes`, helpers named in `ubon.json`). Fixed base URL with a request-derived path segment is `warn`. | SEC030 | 4.0 |
| `web/path-traversal` | block | file | `fs` reads/writes/unlinks, `createReadStream`, `res.sendFile`, `Bun.file` with a request-derived path. | A `path.resolve` or `path.normalize` followed by a `startsWith(root)` check on the same value clears the finding. | SEC027 | 4.0 |
| `web/code-eval` | block | file | `eval`, `new Function`, `vm.run*`, `setTimeout`/`setInterval` with a string, or dynamic `import()` whose argument is request-derived or model-derived. With a non-constant argument of unknown origin it is `warn`. | Constant arguments ignored. Build tooling config files ignored. | SEC016, NEXT004, VITE003 | 4.0 |
| `web/xss-html-sink` | warn (block when request- or model-derived) | file | `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, Vue `v-html`, Svelte `{@html}`, Astro `set:html` with a non-constant value. | Sanitizers recognized (`DOMPurify.sanitize`, `sanitize-html`, `xss`, `rehype-sanitize`, `isomorphic-dompurify`). `JSON.stringify` inside a `type="application/ld+json"` script is `warn` with a specific message about `</script>` escaping. Theme-flash scripts with constant strings ignored. | SEC017 | 4.0 |
| `web/webhook-unverified` | block | file | A webhook handler (route path or file name contains `webhook`, or it reads `stripe-signature`, `svix-*`, `x-hub-signature-256`, `x-slack-signature` headers) that reads the body and writes state without calling the provider's verification (`stripe.webhooks.constructEvent*`, `new Webhook(...).verify` from svix, `@octokit/webhooks` verify, `crypto.timingSafeEqual` over an HMAC). | Handlers that only log are `warn`. | SEC029 | 4.0 |
| `web/weak-token-randomness` | block | file | `Math.random()` used to produce a token, session id, password, OTP, invite code, or API key (target or enclosing function name is credential-shaped). | Tight name list. `Math.random` for UI, jitter, and sampling is never reported. | SEC024 | 4.0 |
| `web/cors-credentials-wildcard` | block | file | `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`, or an origin reflected from the request header while credentials are allowed and no allowlist check exists. Covers header objects, `cors()` options, Hono `cors`, Next `headers()` config. | Wildcard without credentials is not reported (it is valid for public APIs). | NEXT010 (partly) | 4.0 |
| `web/jwt-unverified` | block | file | Authorization decisions based on `jwt.decode()` / `decodeJwt()` output without a verify call on the same token, `algorithms: ['none']`, or `verify` with `ignoreExpiration: true`. | Decoding for display only (no branch on claims) is `warn`. | none | 4.0 |
| `web/open-redirect` | warn | file | `redirect()`, `NextResponse.redirect()`, `res.redirect()`, `router.push()` with a request-derived target (`next`, `returnTo`, `redirect`, `callbackUrl` parameters) and no same-origin check. | `new URL(constantPath, request.url)` is safe (v3 SEC025 flagged it). A `startsWith('/') && !startsWith('//')` check clears it. Receiver must be a router or response object. | SEC025, NEXT009, NEXT208, NEXT215 | 4.0 |
| `web/insecure-cookie` | warn | file | Cookies named like sessions or tokens set without `httpOnly` and `secure` (Next `cookies().set`, `res.cookie`, Hono `setCookie`, raw `Set-Cookie` strings). | Non-auth cookie names ignored. `secure` not required when the value is set only in development branches. | COOKIE001, COOKIE002, COOKIE004 | 4.0 |
| `web/token-in-web-storage` | warn | file | `localStorage`/`sessionStorage.setItem` with a key or value named like an auth token. | Keys like `theme`, `locale` never match. | REACT011, SEC028 | 4.0 |
| `web/unauthenticated-mutation` | warn | project | A Server Action, route handler with a mutating method, SvelteKit form action, React Router/Remix `action`, Astro endpoint, or Hono/Express route that writes to a database or calls a mutating external API without calling any recognized auth function. Recognized functions include `auth()`, `getServerSession`, `currentUser`, `getUser` on Supabase auth, Clerk, Lucia, Better Auth, Auth.js, and any names listed in `ubon.json` under `auth.functions`. `ubon init` proposes that list from the code. | Public endpoints can be declared in `ubon.json` (`auth.public`). This rule stays at `warn` because intent is not visible in code; `ubon map` and the `security-review` skill hand these to the model for judgment. | NEXT205, NEXT212, ASTRO001, REMIX001, SVELTE002 | 4.1 |
| `web/mass-assignment` | warn | file | Request bodies passed directly as ORM data: `prisma.x.create({ data: body })`, `.update({ data: await req.json() })`, `db.insert(t).values(body)`, `supabase.from(t).insert(body)`, `Model.create(req.body)`. | A schema parse (`zod`, `valibot`, `yup`, `arktype`, `typebox`) on the value clears it. | NEXT213, HONO001 | 4.1 |
| `web/weak-password-hash` | block | file | `md5`, `sha1`, or a single unsalted `sha256` over a password-named value. | Only password-shaped names. File checksums and cache keys never match. | SEC023 | 4.1 |
| `web/timing-unsafe-compare` | warn | file | `===`/`!==` between a secret-named value (API key, token, signature, HMAC) and another value in server code. | Operand must be credential-named (v3 matched `Token` inside `EqualsEqualsEqualsToken`). | SEC031 | 4.1 |
| `web/stack-in-response` | warn | file | `err.stack` or a raw error object serialized into a response body. | Development-only branches ignored. | SEC021 | 4.1 |

## The `data` pack

Database access policies. These rules exist because the largest real-world leaks from AI-built apps in 2025 and 2026 were not code bugs but missing access policies (Supabase tables without row level security, Firebase rules left in test mode).

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `data/rls-disabled` | block | project | A table created in an exposed schema (`public` by default, plus schemas listed in `supabase/config.toml` `api.schemas`) in Supabase migrations or declarative schemas, with no `enable row level security` for it anywhere in the migration history, or an explicit `disable row level security`. | Tables in non-exposed schemas ignored. Views and materialized views reported only when created without `security_invoker`. | LOVABLE001, LOVABLE003 | 4.0 |
| `data/permissive-policy` | block for write policies, warn for read | project | `create policy` for `insert`, `update`, `delete`, or `all` with `using (true)` or `with check (true)` for `anon`, `authenticated`, or `public`, including `storage.objects` policies. A `select` policy with `using (true)` is `warn` (often intended for public content). | Policies scoped to `service_role` ignored. | LOVABLE005, LOVABLE006 | 4.0 |
| `data/service-role-in-client` | block | project | A Supabase client created with the service role key (secret key, `SUPABASE_SERVICE_ROLE_KEY`, or a JWT with `role: service_role`) in a `client` module, or the service role key stored in a public-prefixed env var. | Server modules are fine. | none | 4.0 |
| `data/firebase-open-rules` | block | file | `firestore.rules` or `storage.rules` with `allow read, write: if true`, the test-mode rule `if request.time < timestamp.date(...)`, or `database.rules.json` with `".read": true, ".write": true` at the root. | Read-only public rules on specific paths are `warn`. | none | 4.0 |
| `data/anon-grants` | warn | project | `grant all` or `grant insert, update, delete` to `anon` in migrations. | Grants on exposed views and functions with explicit checks are allowed. | none | 4.1 |

## The `llm` pack

Applications that call language models. The rules follow the OWASP Top 10 for LLM Applications (2025) where a code-level signal exists.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `llm/browser-key` | block | project | An LLM SDK constructed in a `client` module with `dangerouslyAllowBrowser: true` (OpenAI, Anthropic, and compatible SDKs), or a direct request to an LLM API from client code with an `Authorization`/`x-api-key` header built from an env var. | Server modules ignored. | AI001 (partly) | 4.0 |
| `llm/output-to-sink` | block | file | Model output (`generateText().text`, `result.object`, `choices[0].message.content`, `content[0].text`, streamed text) reaching `eval`, `new Function`, `child_process`, raw SQL, or an HTML sink without sanitizing. OWASP LLM05. | Sanitizers and schema parses on the value clear it. | none | 4.0 |
| `llm/tool-dangerous-capability` | block | file | A tool the model can call (Vercel AI SDK `tool({ execute })`, OpenAI function handlers, Anthropic `tool_use` handlers, MCP server tool handlers, LangChain tools) whose handler runs shell commands, `eval`, filesystem writes or deletes, raw SQL, or `fetch` to a model-supplied URL, using model-supplied arguments without an allowlist or schema constraint on those arguments. OWASP LLM06 (excessive agency). | Enum-constrained or allowlisted arguments clear it. Read-only handlers are `warn`. | AI006 | 4.0 |
| `llm/untrusted-system-prompt` | warn | file | Request-derived or fetched content interpolated into a system prompt (`system:` field, `role: 'system'` message, `instructions`). User input in user messages is normal and never reported. | Only system-position content. | AI002 | 4.0 |
| `llm/unbounded-public-endpoint` | warn | project | A route that calls a model and has no auth call, no rate limit (Upstash `Ratelimit`, `@arcjet`, `express-rate-limit`, `hono-rate-limiter`, custom names in `ubon.json`), and no output token limit. Cost abuse risk. | Any one of the three signals clears it. | AI007, AI008 | 4.1 |

## The `deps` pack

Dependencies an agent adds or installs. Offline checks use the manifest and lockfile. Online checks (registry lookups, OSV) run only with `--online`, in `ubon vet`, or when enabled in `ubon.json`, and contact only `registry.npmjs.org` (or the configured registry) and `api.osv.dev`.

Online lookups send package names only, never code or paths. Existence and publisher data come from `GET <registry>/<name>/latest` (about 1.5 KB). Download counts come from the registry's own search endpoint, because `api.npmjs.org` is blocked in some networks (it is blocked in the environment where this plan was written). Creation dates need the full package document, which can be several megabytes for popular packages, so it is fetched only for names with low download counts. Scoped packages that `.npmrc` maps to a private registry are never sent to the public registry; an unscoped name that exists internally but is unclaimed on npm is reported as a dependency confusion risk. Results are cached in the user cache directory with a one-day expiry.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `deps/undeclared-import` | warn (block in diff when the package is also absent from `node_modules`) | project | A bare import of a package not declared in the nearest `package.json`. | Node built-ins (with and without `node:`), workspace packages, `tsconfig` path aliases, framework virtual modules (`astro:*`, `$app/*`, `$lib/*`, `virtual:*`, `~icons/*`), type-only imports satisfied by `@types/*`, pnpm catalogs. v3 VIBE001 lacked most of these. | VIBE001 | 4.0 |
| `deps/nonexistent-package` | block | hook, diff (online) | A package in an install command or newly added to `package.json` that does not exist on the registry (a likely hallucination and a slopsquatting target). | Private registries and scopes listed in `.npmrc` are resolved against their own registry, or skipped when unreachable. | none | 4.0 |
| `deps/young-package` | block (ask in hooks) | hook, diff (online) | A newly added package first published less than `packages.minAgeDays` ago (default 7), or a newly added version published less than `packages.minReleaseAgeHours` ago (default 48). Most malicious versions in 2025 and 2026 were caught within hours or days of publication, so a short cooldown blocks most of them. | Scopes and names on the `packages.allow` list skip the check. | none | 4.0 |
| `deps/typosquat` | warn (ask in hooks) | hook, diff | A newly added package name within one edit of a popular package name, or a known confusable pattern (scope dropped, hyphen swapped, `-js` suffix). Uses a bundled list of the most-downloaded npm names. Offline. | Exact matches and the popular package itself never match. | none | 4.0 |
| `deps/install-script` | warn | diff | A newly added package (direct or transitive, from the lockfile diff) with `preinstall`/`install`/`postinstall` scripts (`hasInstallScript` in `package-lock.json`, `requiresBuild` in `pnpm-lock.yaml`). The Shai-Hulud worms spread through install scripts. | Packages on the allow list, and packages already present at the base revision. | none | 4.0 |
| `deps/non-registry-source` | warn | diff | Dependencies from `git+`, `github:`, raw tarball URLs, or `file:` paths outside the workspace; lockfile `resolved` URLs on hosts other than the configured registry. | Workspace protocols (`workspace:*`, `catalog:`) allowed. | none | 4.0 |
| `deps/lockfile-drift` | warn | diff | `package.json` dependencies changed without a lockfile change, or two lockfiles for different package managers. | Repos without any lockfile get one informational note, not a finding per dependency. | none | 4.1 |
| `deps/known-malicious` | block (online) | hook, diff | A package or version named in an install command or added in the diff that has an OpenSSF malicious-package record (`MAL-*` in OSV). | none; these records are human-confirmed. | none | 4.0 |
| `deps/provenance-downgrade` | warn (ask in hooks, online) | hook, diff | A new version of a dependency that was previously published with trusted publishing or provenance and now has neither, the same signal as pnpm's `trustPolicy: no-downgrade`. Provenance does not prove a package is safe (the May 2026 TanStack compromise shipped with valid provenance), but losing it on a package that had it is a strong signal that the publishing path changed. | Packages that never had provenance are not reported. | none | 4.1 |
| `deps/known-vulnerable` | block for critical, warn otherwise (online) | diff | A dependency version added or changed in this diff with a known advisory in OSV. Full-tree audits stay the job of `npm audit` or `osv-scanner`. | Only versions introduced in the diff. | OSV001 | 4.1 |

## The `agent` pack

Agent instruction files, agent configuration, hooks, skills, and the commands agents run. The command checks (the second table) run in `PreToolUse`-style hooks before the command executes.

### File rules

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `agent/hidden-unicode` | block | file | Invisible or direction-changing characters in `agent` files (zero-width characters, bidi controls U+202A to U+202E and U+2066 to U+2069, Unicode tag characters U+E0000 to U+E007F used for ASCII smuggling) and bidi controls in source code (Trojan Source, CVE-2021-42574). This is how "rules file backdoor" attacks hide instructions. | Zero-width joiners inside emoji sequences and legitimate right-to-left text in string literals are `warn`. | none | 4.0 |
| `agent/pipe-to-shell` | block | file | Remote content piped into an interpreter (`curl ... \| sh`, `wget -O- ... \| bash`, `bash <(curl ...)`, `iex (iwr ...)`, `base64 -d \| sh`) inside hooks, skills, commands, agent instructions, devcontainer lifecycle scripts, and package scripts. | Code blocks in docs are `warn`; hooks, skills, and scripts that run automatically are `block`. | CC003, CC011 | 4.0 |
| `agent/secret-in-config` | block | file | Literal tokens in agent config env blocks and headers (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.claude/settings*.json`, `.codex/config.toml`, `.gemini/settings.json`), including values without a known provider prefix when they are high-entropy and the key name is credential-shaped. | `${VAR}` references and `env:` indirection allowed. | AI005, CC001, CC005 | 4.0 |
| `agent/broad-permissions` | warn | file | Committed project settings that grant broad autonomy: Claude Code `defaultMode: "bypassPermissions"`, unscoped `Bash` or `Bash(*)` in `allow`, `enableAllProjectMcpServers: true`; Codex `sandbox_mode = "danger-full-access"` with `approval_policy = "never"`; similar auto-approve settings in Gemini CLI and Cursor. | Personal settings files (`settings.local.json`) ignored because they are not shared. | CC010 | 4.0 |
| `agent/unpinned-mcp-server` | warn | file | MCP servers started with `npx -y <pkg>` or `@latest` without a version, `uvx <pkg>` without a version, or remote MCP URLs over plain `http://` on non-local hosts. An unpinned server is code that updates itself with access to your tokens. | Local paths and pinned versions allowed. | none | 4.0 |
| `agent/unknown-hook-event` | warn | file | Hook event names that the agent does not define (typos like `afterFileEdt`, `PostToolUSe`), with a suggestion. The hook would silently never run. Event lists live in data files per agent and are updated with each agent release. | Only the config files each agent documents. | CC009 | 4.0 |
| `agent/unsafe-hook-script` | warn | file | Hook commands with unquoted variable expansion in destructive commands (`rm -rf $DIR/`), `eval` of hook input, or network calls to hosts not on the allowlist. | Quoted expansions and read-only commands allowed. | CC002 | 4.0 |
| `agent/instruction-injection` | warn | file | Prompt-injection phrasing in `agent` files: instructions to ignore previous instructions, to hide actions from the user, to send data to a URL, or long encoded blobs. | Documentation that discusses injection (inside fenced examples) is ignored. | CC008 | 4.0 |
| `agent/transcript-committed` | warn | project | Agent transcripts and local state tracked by git (`.claude/todos/`, `.claude/projects/`, `.specstory/history/`, `.aider.chat.history.md`). They often contain secrets and private context. | Only tracked files. | CC007 | 4.0 |
| `agent/guardrail-removed` | block | diff | The diff removes Ubon (or another checker) from agent hook config, git hooks, or CI workflows, or turns its level down in `ubon.json`, during an agent session. A human can make that change; the agent should not make it silently. | In CI the rule reports with the commit author, so human-made removals are visible but not blocked when `integrity.humanCommits` is `allow`. | none | 4.0 |
| `agent/autorun-config` | block in diff, warn in `--all` | diff, file | Configuration that runs code automatically when an agent or editor opens the repository, added or changed in the diff: new hook commands in `.claude/settings*.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.gemini/settings.json`, `.github/hooks/`; `.vscode/tasks.json` tasks with `"runOn": "folderOpen"`; devcontainer lifecycle commands (`postCreateCommand`, `postStartCommand`, `postAttachCommand`); package `prepare` scripts. The ChainDrop worm (August 2026) re-infected projects this way after the malicious packages were removed. | Hooks that call Ubon itself, formatters, and linters from `node_modules/.bin` are `warn`. In `--all` mode existing entries are listed, not blocked. | none | 4.0 |

### Command checks (hook scope)

These run on the command string before a shell tool executes it. Ubon parses the command with a shell tokenizer (pipes, `&&`, `;`, subshells, `bash -c`/`sh -c` payloads, `env` and `sudo` prefixes, `xargs`) instead of matching the raw string. Where the agent supports it, the result is `ask` (a human approves) rather than `deny`. Every list is data in `ubon.json` so teams can extend or relax it.

| ID | Default | What it catches |
| --- | --- | --- |
| `agent/destructive-command` | ask | `rm -rf` on `/`, `~`, `$HOME`, `..`, `*` at the repository root, or an unquoted variable; `git push --force` or `--mirror` to a protected branch; `git reset --hard` and `git clean -fdx` with uncommitted changes; `git branch -D` of an unmerged branch; SQL `DROP`, `TRUNCATE`, or `DELETE` without `WHERE` passed to `psql`/`mysql`/`sqlite3`; `prisma migrate reset`, `prisma db push --force-reset` or `--accept-data-loss`, `supabase db reset --linked`; `terraform destroy`, `terraform apply -auto-approve`, `kubectl delete`, `aws s3 rm --recursive`, `docker system prune -a --volumes`; `chmod -R 777`; `mkfs`, `dd of=/dev/...`. |
| `agent/secret-exfiltration` | deny | A pipeline that reads a secret source (`.env*`, `~/.aws`, `~/.ssh`, `printenv`, `env`, `gh auth token`, keychain tools) and sends data to the network (`curl`, `wget`, `nc`, `scp`, `ssh`, `gh gist create`) in the same command. |
| `agent/verification-bypass` | deny | `git commit --no-verify` or `-n`, `git push --no-verify`, `HUSKY=0`, `LEFTHOOK=0`, `SKIP=...` for pre-commit, `git config core.hooksPath` changes, edits to `.git/hooks/*`. |
| `agent/remote-script` | ask | The command-time form of `agent/pipe-to-shell`, plus obfuscated execution (`eval "$(echo ... \| base64 -d)"`, `$'\x72\x6d'`-style escapes). |
| `agent/package-install` | ask when a `deps/*` check fails | `npm install/i/add`, `pnpm add/install`, `yarn add`, `bun add/install`, `npx`/`pnpm dlx`/`bunx`/`yarn dlx` of a package not already installed. Runs `deps/nonexistent-package`, `deps/young-package`, and `deps/typosquat` on the named packages before the install happens. In 4.1 the same flow covers `pip install`, `uv add`, and `uv pip install` against PyPI. |
| `agent/publish-or-deploy` | ask | `npm publish`, `pnpm publish`, `gh release create`, `vercel --prod`, `netlify deploy --prod`, `fly deploy`, `firebase deploy`, `supabase db push` to a linked project. |
| `agent/protected-path-write` | ask | Agent edits to Ubon's own config (`ubon.json`), agent hook and permission config (`.claude/settings.json`, `.cursor/hooks.json`, `.codex/config.toml`), CI workflows, `CODEOWNERS`, lockfiles (edit through the package manager instead), and `.git/`. The referee should not be editable by the player without a human seeing it. |

## The `ci` pack

Agents write CI workflows often, and a workflow file is where publish credentials live. The Nx compromise (August 2025) started with a `pull_request_target` workflow that interpolated a pull request title into a shell step. This pack is deliberately small: four rules whose patterns are unambiguous. `zizmor` is the recommended tool for a full audit of GitHub Actions, and the docs say so.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `ci/expression-injection` | block | file | `${{ github.event.* }}`, `${{ github.head_ref }}`, or other attacker-controllable expressions interpolated directly inside a `run:` script. | Values passed through `env:` and referenced as `$VAR` are the safe form. Numeric fields (`github.event.number`) are ignored. | GHA001 (partly) | 4.0 |
| `ci/untrusted-checkout` | block | file | A `pull_request_target` or `workflow_run` workflow that checks out the pull request head (`ref: ${{ github.event.pull_request.head.sha }}` and similar) and then runs scripts or installs dependencies. | Workflows that only label or comment without checking out are fine. | none | 4.0 |
| `ci/publish-token` | warn | file | `npm publish` authenticated with `NODE_AUTH_TOKEN` from a secret instead of trusted publishing (OIDC); `id-token: write` granted in a job triggered by pull requests; caches restored in a release job. | Private registries that do not support OIDC can be listed in `ubon.json`. | none | 4.0 |
| `ci/unpinned-action` | warn | file | Third-party actions referenced by a tag or branch instead of a full commit SHA. The March 2025 `tj-actions/changed-files` compromise worked by moving a tag. | Actions owned by `actions/` and `github/` can be allowed in config; local actions (`./`) ignored. | none | 4.1 |

## The `integrity` pack

Changes that make the project's own checks weaker. These are diff rules: in an agent session the base is the state at session start, in CI it is the merge base. Research on coding agents shows they modify or special-case tests to make them pass (ImpossibleBench, 2025), and this gets more capable, not less, as models improve. These rules make those changes visible and, for the unambiguous ones, blocking.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `integrity/test-skipped` | block | diff | Newly added `.skip`, `.only`, `xit`, `xdescribe`, `fit`, `fdescribe`, `test.todo`, Playwright `test.fixme`/`test.skip(...)`, Vitest `.skipIf`/`.runIf` with a constant, and cheap cross-language forms (`@pytest.mark.skip`, `pytest.skip(`, Go `t.Skip(`). | Lines that existed at the base are ignored. | none | 4.0 |
| `integrity/test-deleted` | block | diff | A test file deleted while the module it tests still exists, or test cases (matched by title) removed from a modified test file. | Deleting a test together with the code it covers is allowed. Renamed titles with an identical body are matched as renames. | none | 4.0 |
| `integrity/type-suppression` | block for `@ts-nocheck`, warn for others | diff | New `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error` without a description, `as any`, `as unknown as T`, `: any` in a file that had none. | Existing suppressions and `*.d.ts` ignored. | MOD004 (partly) | 4.0 |
| `integrity/lint-suppression` | block for file-wide, warn for line-level | diff | New `/* eslint-disable */` without rule names, `// biome-ignore-all`, `// oxlint-disable` file-wide; line-level disables are `warn`. | Generated files ignored. | none | 4.0 |
| `integrity/checks-weakened` | block | diff | `tsconfig` strictness reduced (`strict`, `noImplicitAny`, `strictNullChecks` turned off); coverage thresholds lowered in Jest/Vitest/c8/nyc config; test scripts changed to swallow failures (`\|\| true`, `; exit 0`, `--passWithNoTests` added); CI steps that run tests, lint, or type checks removed, disabled with `if: false`, or given `continue-on-error: true`; ESLint rules moved from `error` to `off`. | Increases in strictness and threshold raises are never reported. | none | 4.0 |
| `integrity/new-suppression` | warn (block when `suppressions.agent` is `human-only`) | diff | New `ubon-ignore` comments or baseline entries. Every one is listed in the output and in the PR summary, so a suppression added by an agent is never silent. | none | none | 4.0 |
| `integrity/assertion-removed` | warn | diff | Assertions removed from a test whose title is unchanged; tests with zero assertions added; tautologies added (`expect(true).toBe(true)`, `expect(x).toBe(x)`, `assert(true)`); assertions wrapped in `try { } catch { }`. | Snapshot assertions counted as assertions. | none | 4.1 |
| `integrity/test-special-case` | warn | diff | Production code that branches on the test environment (`NODE_ENV === 'test'`, `JEST_WORKER_ID`, `VITEST`, `process.env.CI` in business logic) added in the diff. A known way of making tests pass without fixing behavior. | Config files, logging setup, and test utilities ignored. | none | 4.1 |
| `integrity/swallowed-error` | warn | diff | New empty `catch` blocks, `catch { return [] }`, `.catch(() => null)` on database or network calls in non-test code. | Catch blocks that log or rethrow are fine. | SEC022, MOD003 | 4.1 |

## The `hygiene` pack

Advisory checks for leftovers that agents produce. All `warn` except `hygiene/elided-code`, which marks real data loss.

| ID | Level | Scope | What it catches | Guards against false positives | v3 | Milestone |
| --- | --- | --- | --- | --- | --- | --- |
| `hygiene/elided-code` | block | diff | Placeholder comments that stand in for code a model dropped while rewriting a file: `// ... existing code ...`, `// rest of the implementation`, `/* ... */` as the only statement in a body, `<!-- ... unchanged ... -->`. | Only lines added in the diff. Comments inside documentation code fences ignored. | none | 4.0 |
| `hygiene/placeholder` | warn | diff | `throw new Error('Not implemented')`, `TODO: implement`, lorem ipsum in UI strings, `your-api-key-here`, `example.com` endpoints in runtime code. | Test files and fixtures ignored. Plain `TODO` comments are not reported. | DEV002, DEV003, DEV005, VIBE003 | 4.0 |
| `hygiene/variant-file` | warn | diff | Newly added files named like copies (`*-old.*`, `*-new.*`, `*_v2.*`, `* copy.*`, `*.backup`, `*.bak`) next to an existing file with the base name. | Versioned API folders (`/v2/`) ignored. | none | 4.0 |
| `hygiene/mock-data-in-route` | warn | file | Route handlers or Server Actions that return hardcoded arrays of fake records (`John Doe`, `test@example.com`, `Lorem`) instead of querying a data source. | Seed scripts, fixtures, and stories ignored. | DEV004 | 4.1 |
| `hygiene/orphan-file` | warn | diff | A new source file that nothing imports and that is not an entry point (route, page, config, script, test). | Framework conventions for entry points per framework. | VIBE004 (partly) | 4.1 |
| `hygiene/debug-leftover` | warn | diff | `debugger` statements and new `console.log` in non-test runtime code. | Logger modules and CLI entry points ignored. | SEC015 | 4.1 |

## The `prose` pack (optional, off by default)

Ubon's own repository uses this pack in CI to keep README, docs, skills, and CLI messages free of the mannerisms listed in [writing-style.md](writing-style.md). It ships in 4.1 as an opt-in pack for Markdown files (`"packs": { "prose": "warn" }`), because the same tells show up in READMEs and docs that agents write for other projects.

## Rules removed from v3, and what to use instead

Ubon 4 drops rules that other maintained tools already do better, rules that framework builds and type checks already catch, and rules that were noisy or wrong. The table covers all 155 v3 rules.

| v3 rules | Decision | Use instead |
| --- | --- | --- |
| A11Y001 to A11Y007, NEXT005 | Removed | `eslint-plugin-jsx-a11y`, axe in tests |
| REACT001 to REACT010 | Removed | `eslint-plugin-react-hooks` (the React Compiler rules), `@eslint-react/eslint-plugin` |
| NEXT001, NEXT002, NEXT201, NEXT202, NEXT203, NEXT216, NEXT218, NEXT219, NEXT220, NEXT222, NEXT223, NEXT224 | Removed | `@next/eslint-plugin-next`, TypeScript, `next build` |
| NEXT217 (hook without `'use client'`) | Removed | `next build` reports it. v3 flagged components that are only imported by client components, which are valid; 12 false positives on `vercel/ai-chatbot`. |
| NEXT214 (`'use server'` module imported from a client file) | Removed | Nothing: this is the documented way to call Server Actions from client components. The v3 fix advice was wrong. |
| NEXT221, EDGE001, EDGE002, EDGE003 | Removed | Bundler and runtime errors already catch these |
| NEXT003, NEXT007, NEXT008, NEXT209, NEXT225, COOKIE003 | Removed | Too noisy to act on; framework middleware and headers config cover the useful part |
| LINK001 to LINK003 | Removed | `lychee` or `linkinator`. Ubon 4 makes no network requests by default. |
| DOCKER001 to DOCKER004 | Removed | `hadolint` |
| GHA001 | Replaced | `ci/expression-injection` covers the high-risk case; `zizmor` and `actionlint` for a full workflow audit |
| JSNET001, MOD001, MOD002, SEC019, TAILWIND001, VITE002, AI003, ENV006, ENV007 | Removed | Style or low-signal checks. `@typescript-eslint/require-await` covers MOD002. |
| VIBE002 (repeated blocks), VIBE004 (unused exports) | Removed | `jscpd`, `knip` |
| DEV001 (TODO comments) | Removed | TODO comments are fine |
| SEC008 (env var with fallback) | Removed | A fallback that is a secret is caught by `secret/provider-key`; other fallbacks are fine |
| SEC018 (high-entropy string) | Merged | Into `secret/provider-key` and `agent/secret-in-config` with name context; bare entropy produced too many false positives |
| OSV001 | Replaced | `deps/known-vulnerable` (diff-scoped, opt-in online); `npm audit` or `osv-scanner` for the full tree |
| SEC002, SEC004 (Supabase URL hardcoded), SEC003 and LOVABLE002 for anon keys | Removed | Supabase URLs and anon or publishable keys are public by design. The real risk is covered by `data/rls-disabled` and `data/permissive-policy`. |
| All other v3 rules | Mapped | See the `v3` column in the tables above |

## Rules that were harmful in v3

Two v3 rules gave advice that makes code worse when an agent follows it. They are listed here so the mistake is not repeated:

- **NEXT214** told agents never to import a `'use server'` module into a client component. That import is how Server Actions are meant to be called (React and Next.js docs). An agent following the advice restructures correct code.
- **DRIZZLE001** reported `` sql`... ${value}` `` in Drizzle as SQL injection. Drizzle's `sql` tag parameterizes interpolated values, so this is the safe form. An agent trying to silence the finding could switch to `sql.raw()`, which is the unsafe form.

In an agent loop, a wrong rule is worse than a missing rule, because agents comply. This is the reason for the precision gate below.

## How a rule reaches `block`

1. Fixtures first: `fixtures/rules/<pack>/<name>/` holds files with inline expectations (`// expect: web/ssrf`) and known-safe cases (`// ok: allowlist check`). The rule test fails on any missing or extra finding.
2. Corpus run: the rule runs on the pinned real-world corpus (see the main plan). Every finding is triaged into `corpus/triage.jsonl` as a true or false positive, with a one-line note.
3. Precision gate: a rule ships at `block` only with at least 95 percent precision on the corpus and zero findings on the clean twin of every fixture app. Below that it ships at `warn` or not at all.
4. Documentation: `ubon explain <id>` and `docs/rules/<pack>/<name>.md` are generated from the rule metadata and its fixtures, so every example in the docs is a tested example.
5. Review each year: a rule whose hit rate on the corpus and in agent evaluations drops to zero, and whose problem is covered by the framework or by another maintained tool, is retired.

## Standards mapping

Each rule's metadata lists the CWE and, where one fits, the OWASP category. SARIF output carries them as tags and sets `security-severity`, so GitHub code scanning sorts and filters Ubon findings next to CodeQL's.

| Pack | Main references |
| --- | --- |
| `secret` | CWE-798 (hard-coded credentials), CWE-200, CWE-532; OWASP Top 10:2025 A07 (Authentication Failures), A04 (Cryptographic Failures) for private keys |
| `web` | CWE-89, CWE-78, CWE-918, CWE-22, CWE-95, CWE-79, CWE-347, CWE-601, CWE-614, CWE-330, CWE-942; OWASP Top 10:2025 A01 (Broken Access Control), A05 (Injection), A07 (Authentication Failures) |
| `data` | CWE-284, CWE-862; OWASP Top 10:2025 A01 (Broken Access Control) |
| `llm` | OWASP Top 10 for LLM Applications 2025: LLM01, LLM02, LLM05, LLM06, LLM10 |
| `deps` | CWE-1357, CWE-829; OWASP Top 10:2025 A03 (Software Supply Chain Failures) |
| `agent` | OWASP Top 10 for Agentic Applications 2026: ASI01 (goal hijack), ASI02 (tool misuse), ASI04 (agentic supply chain), ASI05 (unexpected code execution), ASI06 (memory and context poisoning) |
| `ci` | CWE-78, CWE-829; OWASP Top 10:2025 A03 |
| `integrity` | No standard category for weakened checks yet; the rule docs cite the reward hacking research (ImpossibleBench). `integrity/swallowed-error` maps to OWASP Top 10:2025 A10 (Mishandling of Exceptional Conditions). |

The exact CWE per rule is set when the rule is implemented and checked in review; the table lists the intended families.
