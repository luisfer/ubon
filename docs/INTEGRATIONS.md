# Ubon Integrations

How Ubon plugs into the AI tools and frameworks people actually ship with.

This page replaces the older `CURSOR.md`, `LOVABLE.md`, and `COMPARISON.md`.
Sections are independent — jump to the one you need.

---

## Cursor

Ubon ships first-class hooks for Cursor:

- **MCP server** — `ubon mcp` exposes scan / explain / preview-fixes / apply-fixes
  as tools the agent can call directly. See [docs/MCP.md](./MCP.md).
- **Cursor hooks** — `ubon hooks install --cursor` writes
  `.cursor/hooks.json` plus shell scripts for `afterFileEdit` and
  `beforeSubmitPrompt` so every edit gets a quiet scan and every prompt
  is checked for leaked secrets.
- **LSP** — `ubon lsp` provides inline diagnostics with `confidenceReason`
  in hover text. Use it from any LSP-aware editor including Cursor.

### Recommended `.cursor/rules/ubon.mdc`

```markdown
---
description: Ubon security scanner integration
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.svelte", "**/*.astro"]
---

# Ubon Security Scanner

Use Ubon when changes touch security-sensitive code:
- `ubon check --quiet --json` — programmatic results
- `ubon check --focus-critical` — only high-severity findings
- `ubon check --preview-fixes` — see auto-fixes before applying
- `ubon check --apply-fixes` — apply safe deterministic fixes

Each finding includes `ruleId`, `confidence`, `confidenceReason`, and
`fix`. Treat findings with `confidence >= 0.85` as real; below that, use
judgement. Suppress with inline `// ubon-disable-next-line RULEID`.
```

### Workflow

```bash
ubon doctor                                # check environment
ubon check --ai-friendly --explain         # initial scan
ubon check --git-changed-since HEAD~1      # incremental
ubon check --focus-critical --fail-on error # pre-PR gate
ubon check --apply-fixes                   # apply safe fixes
```

---

## Lovable

Lovable apps follow a known stack: React + Vite + Supabase + Tailwind.
Ubon auto-detects it and runs the `lovable` profile with specialized
Supabase / Vite / React rules.

```bash
npm install -g ubon@latest
cd your-lovable-app
ubon scan --interactive
# or explicitly:
ubon scan --profile lovable
```

### Auto-detection

Ubon picks the `lovable` profile when it sees `vite.config.*`,
`@supabase/supabase-js` in `package.json`, React, and Tailwind.

### Rule highlights

<!-- ubon:rules:lovable -->

| Rule       | What it catches                                                                  |
| ---------- | -------------------------------------------------------------------------------- |
| LOVABLE001 | Supabase table accessed without RLS policy validation                            |
| LOVABLE002 | Supabase credentials hardcoded in source code                                    |
| LOVABLE003 | Anonymous authentication enabled without RLS policy validation                   |
| LOVABLE004 | Potential SQL injection in Supabase query (string interpolation in `.filter()`)  |
| LOVABLE005 | Weak RLS policy pattern (`USING (true)`, `auth.uid() IS NOT NULL`, etc.)         |
| LOVABLE006 | Supabase storage access without proper bucket / path validation                  |
| VITE001    | Env var without `VITE_` prefix may expose secrets to the client bundle           |
| VITE002    | Development-only code shipped without a production fallback                      |
| VITE003    | Unsafe dynamic `import()` with user input (path-traversal risk)                  |

<!-- /ubon:rules:lovable -->

The full rule catalog lives in [docs/RULES.md](./RULES.md). It is regenerated
from the live registry by `npm run rules:gen`, so descriptions there are
always authoritative.

### Lovable-aware tips

- Use `--profile lovable` even on partial Lovable apps; it's a superset
  of the React profile.
- Run `ubon check --interactive` to walk through findings one-by-one
  with code context and "why it matters".

---

## Comparison: Ubon vs ESLint vs npm audit vs Lovable scanner

| Capability                            | Ubon | ESLint        | npm audit | Lovable scanner |
| ------------------------------------- | ---- | ------------- | --------- | --------------- |
| Hardcoded LLM / vector DB secrets     | Yes  | No            | No        | Partial         |
| Prompt-injection sinks                | Yes  | No            | No        | No              |
| Server Actions / Edge runtime checks  | Yes  | No            | No        | No              |
| Supabase RLS validation               | Yes  | No            | No        | Existence only  |
| Insecure cookies / CORS / redirects   | Yes  | No            | No        | No              |
| Client env-var leaks (Next/Vite)      | Yes  | No            | No        | No              |
| Accessibility basics                  | Yes  | Via plugins   | No        | No              |
| Broken external links                 | Yes  | No            | No        | No              |
| Dependency advisories (OSV)           | Yes  | No            | Yes       | No              |
| Baseline / suppressions               | Yes  | Limited       | No        | No              |
| Safe deterministic auto-fixes         | Yes  | Style only    | No        | No              |
| JSON / SARIF / NDJSON for CI          | Yes  | Limited       | JSON      | No              |
| Markdown PR summary                   | Yes  | No            | No        | No              |
| MCP server for AI agents              | Yes  | No            | No        | No              |
| Code-style / formatting rules         | No   | Yes           | No        | No              |
| Type checking                         | No   | Partial       | No        | No              |

**Use them together.** ESLint covers code style; npm audit covers CVEs in
your dependency tree; Lovable's scanner blocks the obvious leaks; Ubon
covers the "things that look fine to a linter but ship vulnerabilities"
gap that AI assistants regularly produce.
