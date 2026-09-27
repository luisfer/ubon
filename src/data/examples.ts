/**
 * Examples shown by `ubon explain`, extracted from the rule fixtures by
 * scripts/gen-docs.mjs. Do not edit by hand; run `npm run gen`.
 */

export interface RuleExample {
  file: string;
  code: string;
  note?: string;
}

export const EXAMPLES: Record<string, { flagged: RuleExample[]; safe: RuleExample[] }> = {
  "secret/provider-key": {
    "flagged": [
      {
        "file": ".env.example",
        "code": "OPENAI_API_KEY=sk-proj-...8nPa"
      },
      {
        "file": "docs/setup.md",
        "code": "export GITHUB_TOKEN=ghp_...1BTx"
      },
      {
        "file": "lib/anthropic.js",
        "code": "apiKey: \"sk-ant-...MmAA\","
      }
    ],
    "safe": [
      {
        "file": ".env",
        "code": "OPENAI_API_KEY=sk-proj-...jIbX",
        "note": "real .env files are covered by secret/env-file-committed"
      },
      {
        "file": "dist/bundle.min.js",
        "code": "var k=\"sk-proj-...m16V\";",
        "note": "build output is generated and skipped"
      },
      {
        "file": "docs/setup.md",
        "code": "Or use a placeholder while you wait for access: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.",
        "note": "placeholder token in docs"
      }
    ]
  },
  "secret/db-url-password": {
    "flagged": [
      {
        "file": "lib/db.ts",
        "code": "export const prod = postgres('postgres://app:<db-password>@db.prod.internal:5432/app');"
      },
      {
        "file": "lib/db.ts",
        "code": "export const weak = postgres('postgres://postgres:postgres@db.prod.internal:5432/app');"
      },
      {
        "file": "lib/db.ts",
        "code": "export const internal = postgres('postgres://app:<db-password>@pgbouncer:6432/app');"
      }
    ],
    "safe": [
      {
        "file": ".env",
        "code": "DATABASE_URL=postgres://app:<db-password>@db.prod.internal:5432/app",
        "note": ".env files are covered by secret/env-file-committed"
      },
      {
        "file": "docker-compose.yml",
        "code": "DATABASE_URL: postgres://postgres:postgres@db:5432/app",
        "note": "docker service with a default password"
      },
      {
        "file": "docker-compose.yml",
        "code": "CACHE_URL: redis://:<db-password>@cache.example.net:6379",
        "note": "example host from documentation"
      }
    ]
  },
  "secret/public-env-name": {
    "flagged": [
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_OPENAI_API_KEY="
      },
      {
        "file": ".github/workflows/deploy.yml",
        "code": "NEXT_PUBLIC_DATABASE_URL: ${{ secrets.DATABASE_URL }}"
      },
      {
        "file": "app/checkout.tsx",
        "code": "const secret = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;"
      }
    ],
    "safe": [
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_SUPABASE_URL=",
        "note": "URLs are public"
      },
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
        "note": "the anon key is public by design"
      },
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_POSTHOG_KEY=",
        "note": "PostHog project keys are public"
      }
    ]
  },
  "secret/env-file-committed": {
    "flagged": [
      {
        "file": ".env",
        "code": "OPENAI_API_KEY=sk-proj-...MsGg"
      },
      {
        "file": ".env.local",
        "code": "STRIPE_SECRET_KEY=sk_live_...DIMR"
      },
      {
        "file": "apps/web/.env",
        "code": "SUPABASE_SERVICE_ROLE_KEY=eyJ...8PcX"
      }
    ],
    "safe": [
      {
        "file": ".env.development",
        "code": "OPENAI_API_KEY=your-openai-key-here",
        "note": "placeholders only"
      },
      {
        "file": ".env.example",
        "code": "OPENAI_API_KEY=",
        "note": "example files are meant to be committed"
      },
      {
        "file": ".env.production",
        "code": "NEXT_PUBLIC_SITE_URL=https://acme.dev",
        "note": "only public values"
      }
    ]
  },
  "secret/key-file-committed": {
    "flagged": [
      {
        "file": "deploy/id_rsa",
        "code": "-----BEGIN PRIVATE KEY-----...GW/Q\nyRNGWkm1YHVNOwvGD48UbyfFxc1AJvDBj7a8f8/delYCFG5r1B057LwOkr7ZLxQU\n8W/6R+nVD3LFVNJ+I4Mw6XFxPjfw1EDwYh2bZaJ0FsD2T2aWBg5bfN+FDBt2I2CY\nr2ypDoh4FPrawAT0ViKPYMvCZitebyOHqjzKj2Fiypje8Cr+y4jd+l59wnyUilPQ\nvuC1qX68RsnbeKamay2zfBjqWUszAxJmSmrniczBitkPfSlizcG7v0pB5rlB+KS0\njyL28z+W4unCsgylyjoVeYl1x/Q/z8MlcBUKUgDgxXEfrnHkQngDmZHOuGCrviAY\n-----END PRIVATE KEY-----"
      },
      {
        "file": "certs/server.key",
        "code": "-----BEGIN PRIVATE KEY-----...bdwD\n73K8hFZamwK9H1KvoLKdjEvYvZMnrqG9i38GYmNZm1ltgITBnSYcUzCPTjfvdWZn\nUcJarcslzg9hubq+junkfjclF8uFRwDORV+iJru5tlafFUOkXK7C2/3EcMt5TSLi\nRjl1G1jHSDnIS3w7EYr7M2HKLRWEp8R6egY1alF/DGRg03CSLaXdka2OhlPiFByz\nZ3n41vn4Hu4yWqy5RMhkdPDQ1eZuIO2qf7ZthfsmVtklPjMQjsG+9LuGMIHusavi\nn71+Gr3u3ACYN5Hk9Py89PIs8eY4ue/MRGvr2cZz+YiosSFhtg54RbaYAR5Gk+Cp\n-----END PRIVATE KEY-----"
      },
      {
        "file": ".npmrc",
        "code": "//registry.npmjs.org/:_authToken=npm_...XKOJ"
      }
    ],
    "safe": []
  },
  "secret/server-env-in-client": {
    "flagged": [
      {
        "file": "app/components/Chat.tsx",
        "code": "const key = process.env.OPENAI_API_KEY;"
      },
      {
        "file": "app/components/Chat.tsx",
        "code": "const token = import.meta.env.GITHUB_TOKEN;"
      },
      {
        "file": "lib/config.ts",
        "code": "export const stripeKey = process.env.STRIPE_SECRET_KEY;"
      }
    ],
    "safe": [
      {
        "file": "app/api/chat/route.ts",
        "code": "const key = process.env.OPENAI_API_KEY;",
        "note": "route handlers run on the server"
      },
      {
        "file": "app/api/chat/route.ts",
        "code": "return Response.json({ ok: Boolean(key) });",
        "note": "Boolean(key) });"
      },
      {
        "file": "app/components/Chat.tsx",
        "code": "const site = process.env.NEXT_PUBLIC_SITE_URL;",
        "note": "public prefix"
      }
    ]
  },
  "secret/in-prompt": {
    "flagged": [],
    "safe": []
  },
  "secret/in-tool-output": {
    "flagged": [],
    "safe": []
  },
  "secret/read-sensitive-file": {
    "flagged": [],
    "safe": []
  },
  "web/sql-injection": {
    "flagged": [
      {
        "file": "app/api/users/route.ts",
        "code": "const users = await prisma.$queryRawUnsafe(`SELECT * FROM \"User\" WHERE name = '${name}'`);"
      },
      {
        "file": "app/api/users/route.ts",
        "code": "const sorted = await db.execute(sql.raw(`select * from users order by ${name}`));"
      },
      {
        "file": "server/routes/items.js",
        "code": "const sorted = await pool.query('SELECT * FROM items ORDER BY ' + req.query.sort);"
      }
    ],
    "safe": [
      {
        "file": "app/api/users/route.ts",
        "code": "const same = await prisma.$queryRaw`SELECT * FROM \"User\" WHERE name = ${name}`;",
        "note": "Prisma tagged template sends name as a parameter"
      },
      {
        "file": "app/api/users/route.ts",
        "code": "const rows = await db.execute(sql`select * from users where name = ${name}`);",
        "note": "Drizzle sql tag parameterizes interpolated values"
      },
      {
        "file": "app/api/users/route.ts",
        "code": "const found = await prisma.$executeRawUnsafe('UPDATE \"User\" SET verified = true WHERE email = $1', email);",
        "note": "the SQL text is constant; email is a positional parameter"
      }
    ]
  },
  "web/command-injection": {
    "flagged": [
      {
        "file": "app/api/convert/route.ts",
        "code": "await execAsync(`convert ${file} out.${format}`);"
      },
      {
        "file": "app/api/convert/route.ts",
        "code": "spawn('convert', [file, 'out.png'], { shell: true });"
      },
      {
        "file": "server/media.ts",
        "code": "await execa(`ffmpeg -i ${input} out.mp4`, { shell: true });"
      }
    ],
    "safe": [
      {
        "file": "app/api/convert/route.ts",
        "code": "execFile('convert', [file, `out.${format}`]);",
        "note": "argument array without a shell"
      },
      {
        "file": "app/api/convert/route.ts",
        "code": "spawn('convert', [file, 'out.png']);",
        "note": "fixed program, no shell"
      },
      {
        "file": "app/api/convert/route.ts",
        "code": "await execAsync(`convert ${quote([file])} out.png`);",
        "note": "shell-quote escapes the value"
      }
    ]
  },
  "web/ssrf": {
    "flagged": [
      {
        "file": "app/api/favicon/route.ts",
        "code": "const page = await fetch(`${config.upstream}${path}`);"
      },
      {
        "file": "app/api/image/route.ts",
        "code": "return fetch(new URL(callback));"
      },
      {
        "file": "app/api/preview/route.ts",
        "code": "const page = await fetch(url);"
      }
    ],
    "safe": [
      {
        "file": "app/api/favicon/route.ts",
        "code": "const icon = await fetch(`${FAVICONS}${domain}`);",
        "note": "module constant fixes the host; the value goes in the query"
      },
      {
        "file": "app/api/image/route.ts",
        "code": "const image = await fetch(parsed);",
        "note": "hostname checked against an allowlist"
      },
      {
        "file": "app/api/image/route.ts",
        "code": "await fetch(target, { method: 'POST', body: '{}' });",
        "note": "validated by an allowlist helper"
      }
    ]
  },
  "web/path-traversal": {
    "flagged": [
      {
        "file": "app/api/upload/route.ts",
        "code": "await writeFile(`public/uploads/${name}`, bytes);"
      },
      {
        "file": "app/api/upload/route.ts",
        "code": "const css = await readFile(`themes/${theme}.css`, 'utf8');"
      },
      {
        "file": "server/files.js",
        "code": "res.sendFile(path.join(UPLOADS, req.params.name));"
      }
    ],
    "safe": [
      {
        "file": "app/api/upload/route.ts",
        "code": "await writeFile(`public/uploads/${randomUUID()}.png`, bytes);",
        "note": "file name generated on the server"
      },
      {
        "file": "app/api/upload/route.ts",
        "code": "return Response.json({ ok: true });",
        "note": "true });"
      },
      {
        "file": "app/api/upload/route.ts",
        "code": "const doc = await readFile(`data/${id}.json`, 'utf8');",
        "note": "numeric cast"
      }
    ]
  },
  "web/code-eval": {
    "flagged": [
      {
        "file": "lib/formula.ts",
        "code": "return eval(formula);"
      },
      {
        "file": "server/calc.js",
        "code": "const result = eval(req.body.expression);"
      },
      {
        "file": "server/calc.js",
        "code": "const fn = new Function('x', req.body.body);"
      }
    ],
    "safe": [
      {
        "file": "lib/formula.ts",
        "code": "return import(`../locales/${locale}.json`);",
        "note": "dynamic import of unknown origin is code splitting, not reported"
      },
      {
        "file": "lib/formula.ts",
        "code": "return eval(text);",
        "note": "model output is reported by llm/output-to-sink, not here"
      },
      {
        "file": "server/calc.js",
        "code": "setTimeout(() => res.end(), 100);",
        "note": "a function, not a string"
      }
    ]
  },
  "web/xss-html-sink": {
    "flagged": [
      {
        "file": "app/providers.tsx",
        "code": "<script dangerouslySetInnerHTML={{ __html: `window.__USER__ = ${JSON.stringify(state.user)};` }} />"
      },
      {
        "file": "app/search/page.tsx",
        "code": "<h1 dangerouslySetInnerHTML={{ __html: `Results for ${q}` }} />"
      },
      {
        "file": "components/Post.tsx",
        "code": "<div dangerouslySetInnerHTML={{ __html: html }} />"
      }
    ],
    "safe": [
      {
        "file": "app/layout.tsx",
        "code": "<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />",
        "note": "constant theme-flash script"
      },
      {
        "file": "app/layout.tsx",
        "code": "<script dangerouslySetInnerHTML={{ __html: ANALYTICS_SNIPPET }} />",
        "note": "constant imported from another module"
      },
      {
        "file": "app/providers.tsx",
        "code": "<script dangerouslySetInnerHTML={{ __html: `window.__STATE__ = ${serialized};` }} />",
        "note": "'<' escaped before it reaches the script"
      }
    ]
  },
  "web/open-redirect": {
    "flagged": [
      {
        "file": "app/api/auth/callback/route.ts",
        "code": "return NextResponse.redirect(new URL(next, request.url));"
      },
      {
        "file": "app/auth/confirm/route.ts",
        "code": "if (next) return NextResponse.redirect(requestUrl.origin + next);"
      },
      {
        "file": "app/login/actions.ts",
        "code": "redirect(destination);"
      }
    ],
    "safe": [
      {
        "file": "app/api/auth/callback/route.ts",
        "code": "if (searchParams.has('error')) return NextResponse.redirect(new URL('/login', request.url));",
        "note": "constant path on the request's own origin"
      },
      {
        "file": "app/api/auth/callback/route.ts",
        "code": "return NextResponse.redirect(new URL(target, request.url));",
        "note": "only relative paths pass the check"
      },
      {
        "file": "app/api/auth/callback/route.ts",
        "code": "return NextResponse.redirect(url);",
        "note": "origin compared with the request's origin"
      }
    ]
  },
  "data/rls-disabled": {
    "flagged": [
      {
        "file": "supabase/migrations/20240501000000_add_invoices.sql",
        "code": "create table public.invoices ("
      },
      {
        "file": "supabase/migrations/20240301000000_tables.sql",
        "code": "create table public.comments (id uuid primary key, body text);"
      },
      {
        "file": "supabase/migrations/20240301000000_tables.sql",
        "code": "create table public.labels (id int, name text);"
      }
    ],
    "safe": [
      {
        "file": "supabase/migrations/20240101000000_init.sql",
        "code": "create table public.legacy_logs (id bigserial primary key, line text);",
        "note": "existing debt in an unchanged migration is not reported in diff mode"
      },
      {
        "file": "supabase/migrations/20240501000000_add_invoices.sql",
        "code": "create table public.invoice_lines (",
        "note": "row level security enabled in the same migration"
      },
      {
        "file": "supabase/migrations/20240301000000_tables.sql",
        "code": "create table public.projects (id uuid primary key, owner uuid);",
        "note": "the DO block below enables row level security on every public table"
      }
    ]
  },
  "data/permissive-policy": {
    "flagged": [
      {
        "file": "supabase/migrations/20240601000000_message_edits.sql",
        "code": "create policy \"Anyone can edit messages\" on public.messages for update using (true) with check (true);"
      },
      {
        "file": "supabase/migrations/20240101000000_posts.sql",
        "code": "create policy \"Anyone can read posts\" on public.posts for select using (true);"
      },
      {
        "file": "supabase/migrations/20240101000000_posts.sql",
        "code": "create policy \"Anyone can create posts\" on public.posts for insert with check (true);"
      }
    ],
    "safe": [
      {
        "file": "supabase/migrations/20240101000000_init.sql",
        "code": "create policy \"Anyone can post\" on public.messages for insert with check (true);",
        "note": "existing policy in an unchanged migration is not reported in diff mode"
      },
      {
        "file": "supabase/migrations/20240601000000_message_edits.sql",
        "code": "create policy \"Senders can delete their messages\" on public.messages for delete to authenticated using (sender = (select auth.uid()));",
        "note": "checks the sender"
      },
      {
        "file": "supabase/migrations/20240101000000_posts.sql",
        "code": "create policy \"Owners can edit their posts\" on public.posts",
        "note": "checks the row owner"
      }
    ]
  },
  "data/service-role-in-client": {
    "flagged": [
      {
        "file": "app/admin/page.tsx",
        "code": "const admin = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);"
      },
      {
        "file": "app/admin/page.tsx",
        "code": "const client = createClient(supabaseUrl, serviceKey);"
      },
      {
        "file": "lib/supabase-admin.ts",
        "code": "export const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRole!, {"
      }
    ],
    "safe": [
      {
        "file": "app/admin/actions.ts",
        "code": "const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);",
        "note": "a Server Action module stays on the server"
      },
      {
        "file": "app/admin/page.tsx",
        "code": "const anon = createClient(supabaseUrl, 'eyJhbGciOiJI...');",
        "note": "the anon key is public by design"
      },
      {
        "file": "app/api/admin/route.ts",
        "code": "await createServiceClient().from('posts').delete().eq('id', id);",
        "note": "server code calls the service client"
      }
    ]
  },
  "data/firebase-open-rules": {
    "flagged": [
      {
        "file": "apps/site/firestore.rules",
        "code": "allow read: if true;"
      },
      {
        "file": "apps/site/firestore.rules",
        "code": "allow write: if request.auth != null;"
      },
      {
        "file": "examples/chat/firestore.rules",
        "code": "allow read, write: if true;"
      }
    ],
    "safe": [
      {
        "file": "apps/site/firestore.rules",
        "code": "allow read: if resource.data.visible == true;",
        "note": "reads limited to visible comments"
      },
      {
        "file": "apps/site/firestore.rules",
        "code": "allow update: if request.auth.uid != null && request.auth.uid == resource.data.author;",
        "note": "author check"
      },
      {
        "file": "apps/site/firestore.rules",
        "code": "allow update: if request.auth.uid != null;",
        "note": "signed-in writes on one path are not reported"
      }
    ]
  },
  "llm/output-to-sink": {
    "flagged": [
      {
        "file": "app/api/report/route.ts",
        "code": "const rows = await pool.query(text);"
      },
      {
        "file": "app/api/report/route.ts",
        "code": "const noted = await pool.query(`INSERT INTO notes (body) VALUES ('${object.note}')`);"
      },
      {
        "file": "components/Chat.tsx",
        "code": "<div dangerouslySetInnerHTML={{ __html: marked.parse(m.content) }} />"
      }
    ],
    "safe": [
      {
        "file": "app/api/report/route.ts",
        "code": "const sorted = await pool.query(`SELECT * FROM invoices ORDER BY ${object.sortBy}`);",
        "note": "enum field of a schema-checked object"
      },
      {
        "file": "app/api/report/route.ts",
        "code": "const safe = await pool.query('INSERT INTO notes (body) VALUES ($1)', [text]);",
        "note": "model output passed as a parameter"
      },
      {
        "file": "components/Chat.tsx",
        "code": "<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(m.content) as string) }} />",
        "note": "sanitized"
      }
    ]
  },
  "llm/tool-dangerous-capability": {
    "flagged": [
      {
        "file": "agents/sql-tool.ts",
        "code": "const rows = await db.query(query);"
      },
      {
        "file": "lib/ai/tools.ts",
        "code": "const { stdout } = await run(command);"
      },
      {
        "file": "lib/ai/tools.ts",
        "code": "execute: async ({ path, content }) => fs.writeFile(path, content),"
      }
    ],
    "safe": [
      {
        "file": "lib/ai/tools.ts",
        "code": "execute: async ({ branch }) => (await run(`git log ${branch} --oneline`)).stdout,",
        "note": "branch is an enum"
      },
      {
        "file": "lib/ai/tools.ts",
        "code": "return (await run(command)).stdout;",
        "note": "checked against an allowlist"
      },
      {
        "file": "lib/ai/tools.ts",
        "code": "execute: async ({ title, content }) => fs.writeFile(`notes/${randomUUID()}.md`, `# ${title}\\n\\n${content}`),",
        "note": "the path is generated in code; the model only writes the content"
      }
    ]
  },
  "llm/untrusted-system-prompt": {
    "flagged": [
      {
        "file": "app/api/chat/route.ts",
        "code": "system: `You are ${persona}. Answer briefly.`,"
      },
      {
        "file": "server/summarize.ts",
        "code": "instructions: `Summarize using this page: ${page}`,"
      },
      {
        "file": "server/summarize.ts",
        "code": "{ role: 'system', content: `Reply in a ${tone} tone.` },"
      }
    ],
    "safe": [
      {
        "file": "app/api/chat/route.ts",
        "code": "system: SYSTEM,",
        "note": "constant system prompt"
      },
      {
        "file": "app/api/chat/route.ts",
        "code": "messages: convertToModelMessages(messages),",
        "note": "user messages are where user text belongs"
      },
      {
        "file": "server/summarize.ts",
        "code": "input: question,",
        "note": "the user's question goes in the input"
      }
    ]
  },
  "deps/undeclared-import": {
    "flagged": [
      {
        "file": "src/app/page.tsx",
        "code": "import get from 'lodash/get';"
      },
      {
        "file": "src/app/page.tsx",
        "code": "import dayjs from 'dayjs';"
      },
      {
        "file": "src/app/page.tsx",
        "code": "import type { ZodSchema } from 'zod';"
      }
    ],
    "safe": [
      {
        "file": "src/app/page.tsx",
        "code": "import React from 'react';",
        "note": "declared in package.json"
      },
      {
        "file": "src/app/page.tsx",
        "code": "import Link from 'next/link';",
        "note": "subpath of the declared next package"
      },
      {
        "file": "src/app/page.tsx",
        "code": "import { createClient } from '@supabase/supabase-js/dist/main/index.js';",
        "note": "deep import of a declared scoped package"
      }
    ]
  },
  "deps/nonexistent-package": {
    "flagged": [
      {
        "file": "package.json",
        "code": "\"Bad Name\": \"^1.0.0\","
      },
      {
        "file": "package.json",
        "code": "\"react-dom \": \"^19.0.0\","
      },
      {
        "file": "package.json",
        "code": "\"lodash/fp\": \"^4.17.21\","
      }
    ],
    "safe": []
  },
  "deps/young-package": {
    "flagged": [],
    "safe": []
  },
  "deps/typosquat": {
    "flagged": [
      {
        "file": "package.json",
        "code": "\"lodahs\": \"^4.17.21\","
      },
      {
        "file": "package.json",
        "code": "\"expresss\": \"^4.19.2\","
      },
      {
        "file": "package.json",
        "code": "\"react_dom\": \"^19.0.0\","
      }
    ],
    "safe": []
  },
  "deps/install-script": {
    "flagged": [
      {
        "file": "package-lock.json",
        "code": "\"resolved\": \"https://registry.npmjs.org/@parcel/watcher/-/watcher-2.5.0.tgz\","
      },
      {
        "file": "package-lock.json",
        "code": "\"resolved\": \"https://registry.npmjs.org/fsevents/-/fsevents-1.2.13.tgz\","
      },
      {
        "file": "package-lock.json",
        "code": "\"resolved\": \"https://registry.npmjs.org/sharp/-/sharp-0.33.5.tgz\","
      }
    ],
    "safe": [
      {
        "file": ".npmrc",
        "code": "ignore-scripts=true",
        "note": "npm and pnpm run no install scripts in this project, so new packages with scripts are not reported"
      },
      {
        "file": "pnpm-workspace.yaml",
        "code": "onlyBuiltDependencies:",
        "note": "pnpm builds only esbuild; the script of sharp does not run, so sharp is not reported"
      }
    ]
  },
  "deps/non-registry-source": {
    "flagged": [
      {
        "file": "package-lock.json",
        "code": "\"resolved\": \"https://registry.example-mirror.net/fancy-log/-/fancy-log-2.0.0.tgz\","
      },
      {
        "file": "package-lock.json",
        "code": "\"resolved\": \"git+ssh://git@github.com/someone/color-support.git#3333333333333333333333333333333333333333\","
      },
      {
        "file": "package-lock.json",
        "code": "\"resolved\": \"https://downloads.example.com/tarball-dep-1.0.0.tgz\","
      }
    ],
    "safe": [
      {
        "file": ".npmrc",
        "code": "@acme:registry=https://npm.pkg.github.com",
        "note": "the @acme scope comes from GitHub Packages, so its tarball URLs there are fine"
      }
    ]
  },
  "deps/known-malicious": {
    "flagged": [
      {
        "file": "bun.lock",
        "code": "\"commanderr\": [\"commanderr@0.0.1-security\", \"\", {}, \"sha512-commanderr\"],"
      },
      {
        "file": "package.json",
        "code": "\"discordi.js\": \"0.0.1-security\","
      },
      {
        "file": "package.json",
        "code": "\"noblox.js-proxy\": \"0.0.1-security\""
      }
    ],
    "safe": []
  },
  "ci/expression-injection": {
    "flagged": [
      {
        "file": ".github/actions/label/action.yml",
        "code": "case \"${{ github.event.pull_request.title }}\" in"
      },
      {
        "file": ".github/actions/report/action.yml",
        "code": "run: echo \"## ${{ github.event.issue.title }}\" >> \"$GITHUB_STEP_SUMMARY\""
      },
      {
        "file": ".github/workflows/pr-target.yml",
        "code": "title=\"${{ github.event.pull_request.title }}\""
      }
    ],
    "safe": [
      {
        "file": ".github/actions/report/action.yml",
        "code": "run: echo \"## $TITLE\" >> \"$GITHUB_STEP_SUMMARY\"",
        "note": "passed through env"
      },
      {
        "file": ".github/workflows/pr-target.yml",
        "code": "gh pr comment ${{ github.event.pull_request.number }} --body \"Thanks! Title: $PR_TITLE\"",
        "note": "number is numeric, title comes from env"
      },
      {
        "file": ".github/workflows/pr-target.yml",
        "code": "echo \"Merging into ${{ github.event.pull_request.base.ref }}\"",
        "note": "the base branch is chosen by maintainers"
      }
    ]
  },
  "ci/untrusted-checkout": {
    "flagged": [
      {
        "file": ".github/workflows/comment-ops.yml",
        "code": "gh pr checkout ${{ github.event.issue.number }}"
      },
      {
        "file": ".github/workflows/coverage.yml",
        "code": "ref: ${{ github.event.workflow_run.head_sha }}"
      },
      {
        "file": ".github/workflows/fork-branch.yml",
        "code": "repository: ${{ github.event.pull_request.head.repo.full_name }}"
      }
    ],
    "safe": [
      {
        "file": ".github/workflows/ci.yml",
        "code": "- run: npm ci && npm test",
        "note": "pull_request workflows run without secrets"
      },
      {
        "file": ".github/workflows/comment-ops.yml",
        "code": "- run: gh pr view ${{ github.event.issue.number }} --json title",
        "note": "reads metadata only, checks nothing out"
      },
      {
        "file": ".github/workflows/fork-branch.yml",
        "code": "ref: ${{ github.event.pull_request.head.ref }}",
        "note": "a branch name alone is looked up in the base repository, where forks cannot push"
      }
    ]
  },
  "ci/publish-token": {
    "flagged": [
      {
        "file": ".github/workflows/changesets.yml",
        "code": "cache: pnpm"
      },
      {
        "file": ".github/workflows/changesets.yml",
        "code": "- uses: actions/cache@v4"
      },
      {
        "file": ".github/workflows/changesets.yml",
        "code": "NPM_TOKEN: ${{ secrets.NPM_TOKEN }}"
      }
    ],
    "safe": [
      {
        "file": ".github/workflows/changesets.yml",
        "code": "id-token: write",
        "note": "push-only workflow"
      },
      {
        "file": ".github/workflows/changesets.yml",
        "code": "cache: pnpm",
        "note": "this job does not publish"
      },
      {
        "file": ".github/workflows/ci.yml",
        "code": "id-token: write",
        "note": "a test job (cloud login); forks get no OIDC token and nothing is published"
      }
    ]
  },
  "integrity/invalid-suppression": {
    "flagged": [],
    "safe": []
  },
  "integrity/unused-suppression": {
    "flagged": [],
    "safe": []
  },
  "integrity/test-skipped": {
    "flagged": [
      {
        "file": "src/slug.test.js",
        "code": "fit('lowercases', () => { // expect-block: integrity/test-skipped"
      },
      {
        "file": "e2e/checkout.spec.ts",
        "code": "test.fixme();"
      },
      {
        "file": "e2e/checkout.spec.ts",
        "code": "test.describe.skip('invoices', () => {"
      }
    ],
    "safe": [
      {
        "file": "src/slug.test.js",
        "code": "it.skip('keeps emoji', () => {",
        "note": "this skip existed at the base (the file is CRLF, the check compares lines without CR)"
      },
      {
        "file": "e2e/checkout.spec.ts",
        "code": "test.skip(browserName === 'webkit', 'The payment iframe does not load in WebKit');",
        "note": "a conditional skip on a fixture value is a deliberate browser check"
      },
      {
        "file": "e2e/checkout.spec.ts",
        "code": "await context.clearCookies();",
        "note": "context is the browser context fixture, not the Mocha alias"
      }
    ]
  },
  "integrity/test-deleted": {
    "flagged": [
      {
        "file": "src/price.test.ts",
        "code": "import { expect, it } from 'vitest';"
      },
      {
        "file": "pkg/calc_test.go",
        "code": "package pkg"
      },
      {
        "file": "tests/test_billing.py",
        "code": "import pytest"
      }
    ],
    "safe": [
      {
        "file": "test/util/format.test.ts",
        "code": "describe('formatName', () => {",
        "note": "moved here from src/util/__tests__/, not deleted"
      },
      {
        "file": "src/cart.test.ts",
        "code": "it('returns the price of a single item', () => {",
        "note": "\"applies a discount\" was removed together with applyDiscount()"
      },
      {
        "file": "src/cart.test.ts",
        "code": "it('returns the price of a single item', () => {",
        "note": "\"works for one item\" was renamed; the body is the same"
      }
    ]
  },
  "integrity/type-suppression": {
    "flagged": [
      {
        "file": "src/api.test.ts",
        "code": "// @ts-nocheck"
      },
      {
        "file": "src/user.ts",
        "code": "export function parseUser(input: any): User {"
      },
      {
        "file": "src/user.ts",
        "code": "const user = input as unknown as User;"
      }
    ],
    "safe": [
      {
        "file": "src/api.test.ts",
        "code": "const input = { id: 1, name: 'Ada' } as any;",
        "note": "tests cast mocks with `as any`"
      },
      {
        "file": "src/api.test.ts",
        "code": "expect(() => parseUser()).toThrow();",
        "note": "tests pass invalid arguments on purpose"
      },
      {
        "file": "src/globals.d.ts",
        "code": "declare const legacyWidget: any;",
        "note": "declaration files are ignored"
      }
    ]
  },
  "integrity/lint-suppression": {
    "flagged": [
      {
        "file": "pkg/store.go",
        "code": "os.Remove(path + \".bak\") //nolint:errcheck"
      },
      {
        "file": "src/charts.js",
        "code": "// oxlint-disable"
      },
      {
        "file": "src/format.test.ts",
        "code": "/* eslint-disable */"
      }
    ],
    "safe": [
      {
        "file": "src/generated/client.ts",
        "code": "export const client = { version: 1 };",
        "note": "generated code (under a generated/ folder) is ignored"
      },
      {
        "file": "src/logger.ts",
        "code": "const write = console.log;",
        "note": "this disable existed at the base; it only moved below the function"
      },
      {
        "file": "src/report.test.ts",
        "code": "console.log(report([1] as any));",
        "note": "line-level and rule-scoped disables in tests are not reported"
      }
    ]
  },
  "integrity/checks-weakened": {
    "flagged": [
      {
        "file": ".github/workflows/ci.yml",
        "code": "test:"
      },
      {
        "file": ".github/workflows/ci.yml",
        "code": "continue-on-error: true"
      },
      {
        "file": ".github/workflows/ci.yml",
        "code": "if: false"
      }
    ],
    "safe": [
      {
        "file": ".github/workflows/backend.yml",
        "code": "- run: go vet ./...",
        "note": "go.yml was deleted, and its checks moved to this workflow"
      },
      {
        "file": ".github/workflows/ci.yml",
        "code": "- name: Unit tests",
        "note": "new flags on the same test command are not a removal"
      },
      {
        "file": ".github/workflows/ci.yml",
        "code": "- name: Bundle size report",
        "note": "a new optional job that is allowed to fail did not exist before"
      }
    ]
  },
  "integrity/new-suppression": {
    "flagged": [
      {
        "file": ".ubon/baseline.json",
        "code": "{ \"rule\": \"hygiene/placeholder\", \"file\": \"src/api.ts\", \"fingerprint\": \"7d1e2c3b4a596877\" },"
      },
      {
        "file": ".ubon/baseline.json",
        "code": "{ \"rule\": \"secret/provider-key\", \"file\": \"src/stripe.ts\", \"fingerprint\": \"a1b2c3d4e5f60718\" }"
      },
      {
        "file": "docs/setup.md",
        "code": "<!-- ubon-ignore secret/provider-key: luisfer: the key below is the public Stripe example key -->"
      }
    ],
    "safe": [
      {
        "file": "lib/payments.ts",
        "code": "export const testKey = 'pk_test_placeholder';",
        "note": "this suppression existed at the base; it only moved below charge()"
      },
      {
        "file": "lib/payments.ts",
        "code": "export const other = 'your-api-key-here';",
        "note": "an ubon-ignore without a reason suppresses nothing (integrity/invalid-suppression reports it)"
      },
      {
        "file": "lib/payments.ts",
        "code": "export const help = 'Write // ubon-ignore <rule>: <who>: <evidence> above the line.';",
        "note": "the syntax inside a string is not a suppression"
      }
    ]
  },
  "hygiene/elided-code": {
    "flagged": [
      {
        "file": "README.md",
        "code": "<!-- ... rest of the file unchanged ... -->"
      },
      {
        "file": "src/components/Profile.tsx",
        "code": "{/* ... */}"
      },
      {
        "file": "src/routes.ts",
        "code": "// ... existing routes ..."
      }
    ],
    "safe": [
      {
        "file": "README.md",
        "code": "ok: comments in fenced code blocks are documentation, not elision.",
        "note": "comments in fenced code blocks are documentation, not elision."
      },
      {
        "file": "docs/snippets/router.ts",
        "code": "export const routes = [",
        "note": "code under docs/ is documentation, where placeholder comments are deliberate"
      },
      {
        "file": "src/routes.ts",
        "code": "return fn().catch((error) => {",
        "note": "prose that starts with an ellipsis is not elision"
      }
    ]
  },
  "hygiene/placeholder": {
    "flagged": [
      {
        "file": "app/sync.py",
        "code": "raise NotImplementedError(\"TODO\")"
      },
      {
        "file": "src/billing.ts",
        "code": "const res = await fetch('https://api.example.com/invoices', {"
      },
      {
        "file": "src/billing.ts",
        "code": "headers: { Authorization: `Bearer ${process.env.BILLING_KEY ?? 'your-api-key-here'}` },"
      }
    ],
    "safe": [
      {
        "file": "app/sync.py",
        "code": "raise NotImplementedError",
        "note": "a bare NotImplementedError is the usual way to mark an abstract method"
      },
      {
        "file": "src/billing.test.ts",
        "code": "it('calls the API', () => {",
        "note": "tests use example.com endpoints and placeholder keys on purpose"
      },
      {
        "file": "src/billing.ts",
        "code": "export function refund(): void {",
        "note": "a plain TODO about future work is fine"
      }
    ]
  },
  "hygiene/variant-file": {
    "flagged": [
      {
        "file": "src/components/Header-new.tsx",
        "code": "export function Header() {"
      },
      {
        "file": "src/lib/pricing.ts.bak",
        "code": "export function price(n: number): number {"
      }
    ],
    "safe": [
      {
        "file": "src/api/v2/users.ts",
        "code": "export const users = [{ name: 'ada' }];",
        "note": "a versioned API folder is deliberate"
      },
      {
        "file": "src/components/Footer-new.tsx",
        "code": "export function Footer() {",
        "note": "there is no Footer.tsx next to it, so this is not a copy"
      },
      {
        "file": "src/net/http2.ts",
        "code": "export const protocol = 'h2';",
        "note": "http2 is a protocol name, not a copy of http.ts"
      }
    ]
  }
};
