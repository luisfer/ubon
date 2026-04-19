# 🪷 Ubon

<p align="center">
  <img src="branding/Ubon.png" alt="Ubon — Peace of mind for AI-generated apps" width="100%" />
</p>

> **Security scanner for AI-generated apps.**
> Catches the bugs Cursor, Lovable, Windsurf, v0, and Claude routinely
> ship: hardcoded LLM keys, prompt-injection sinks, leaked Server
> Actions, hallucinated imports, missing auth on streaming endpoints,
> and the other "looks fine to a linter" issues that traditional tools
> miss.

[![npm version](https://badge.fury.io/js/ubon.svg)](https://badge.fury.io/js/ubon)
[![npm downloads](https://img.shields.io/npm/dm/ubon.svg)](https://npmjs.com/package/ubon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#requirements)

## Quick start

```bash
# One-shot, no install
npx ubon@latest check

# Or install globally
npm install -g ubon
ubon check
```

```bash
ubon check                       # fast static scan, exit 1 on errors
ubon scan --interactive          # walk through findings one by one
ubon check --json                # deterministic JSON for agents/CI
ubon check --sarif out.sarif     # SARIF 2.1.0 for GitHub code scanning
ubon mcp                         # serve as an MCP tool to your AI assistant
ubon doctor                      # check environment and optional deps
```

## Why Ubon?

Modern AI coding assistants are great at producing **code that runs**.
They are routinely careless about code that's **safe to deploy**:

- Hardcoded LLM API keys in client bundles
- Server Actions with no auth check
- Streaming routes with no rate limit
- MCP server configs with literal secrets
- `import.meta.env.PUBLIC_*` reading server-only values
- `'use client'` files importing from `actions/`
- Edge runtime routes calling Node-only APIs
- Hallucinated imports that pass the type checker because the package never gets installed

Ubon's job is to catch those, fast, with high confidence and `file:line`
context — and to expose them to the agent itself via JSON / NDJSON / MCP
so the AI can fix what it broke.

## v3.0.0 — what's new

> v3.0.0 is a focused, breaking release. Node 20+ is required and the
> Python / Rails / Vue profiles are gone — see [MIGRATION-v3.md](MIGRATION-v3.md)
> for the upgrade checklist.

- **AI-era rule pack** (`AI001`–`AI008`): hardcoded LLM keys, prompt
  injection, system-prompt leaks to client, vector-DB credentials, MCP
  secrets, unsafe tool calls, unauthenticated streaming, unbounded
  generation calls.
- **Modern framework rules**: Next 14/15 Server Actions
  (`NEXT212`–`NEXT215`), Edge runtime (`EDGE001`–`EDGE003`), SvelteKit,
  Astro, Remix, Hono, Drizzle, Prisma.
- **`ubon mcp`**: ship Ubon as a Model Context Protocol server so
  Cursor / Claude Desktop / Windsurf can call `ubon.scan`, `ubon.explain`,
  `ubon.preview-fixes`, and `ubon.apply-fixes` directly. See
  [docs/MCP.md](docs/MCP.md).
- **`ubon hooks install --cursor`**: drop-in `.cursor/hooks.json` for
  `afterFileEdit` and `beforeSubmitPrompt`.
- **Deterministic output**: `--json` and `--ndjson` are byte-for-byte
  identical across runs (sorted keys, stable severity order). The JSON
  Schema is published at `docs/schema/ubon-finding.schema.json` and
  reachable via `ubon check --schema`.
- **`ubon doctor`** for fast environment debugging.
- **CLI cleanup**: `--quiet` for CI, `--ndjson` for streaming agents,
  `--allow-config-js` to gate `ubon.config.js` (which executes user code).
- **Toolchain**: Node 20+, ESLint 9 flat config, picocolors instead of
  chalk, glob 11, commander 13.
- **Scope cut (breaking)**: removed `--profile python`, `--profile rails`,
  and `--profile vue` and their scanners. Selecting them now exits with
  code 2 and points at [MIGRATION-v3.md](MIGRATION-v3.md). Use Bandit,
  Brakeman, or `eslint-plugin-vue` for those ecosystems.
- **Deprecations**: Puppeteer crawler (`--crawl-internal`),
  `ubon.config.js` without `--allow-config-js` — both removed in v3.1.

## How it compares

| Capability                            | Ubon | ESLint        | npm audit | Lovable scanner |
| ------------------------------------- | ---- | ------------- | --------- | --------------- |
| LLM / vector-DB hardcoded secrets     | ✅   | ❌            | ❌        | ⚠️ Partial      |
| Prompt-injection sinks                | ✅   | ❌            | ❌        | ❌              |
| Server Actions / Edge runtime checks  | ✅   | ❌            | ❌        | ❌              |
| Supabase RLS validation               | ✅   | ❌            | ❌        | ⚠️ Existence    |
| Insecure cookies / CORS / redirects   | ✅   | ❌            | ❌        | ❌              |
| Client env-var leaks (Next/Vite)      | ✅   | ❌            | ❌        | ❌              |
| Accessibility basics                  | ✅   | ⚠️ Plugins    | ❌        | ❌              |
| Dependency advisories (OSV)           | ✅   | ❌            | ✅        | ❌              |
| MCP server for AI agents              | ✅   | ❌            | ❌        | ❌              |
| Code style / formatting               | ❌   | ✅            | ❌        | ❌              |

**Use them together.** ESLint covers code style; npm audit covers CVEs
in your dependency tree; Ubon covers the gap that AI assistants
regularly leave behind.

## Cursor integration

```bash
ubon hooks install --cursor   # writes .cursor/hooks.json + scripts
```

Then point Cursor at the MCP server:

```jsonc
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "ubon": { "command": "npx", "args": ["-y", "ubon@latest", "mcp"] }
  }
}
```

Full Cursor + Lovable + comparison details in
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Configuration

```bash
ubon init                          # writes ubon.config.json
ubon check --update-baseline       # accept current findings as baseline
ubon check --baseline .ubon-baseline.json --focus-new --fail-on error
```

```jsonc
// ubon.config.json
{
  "profile": "next",
  "minConfidence": 0.85,
  "failOn": "error",
  "disabledRules": ["VIBE003"],
  "exclude": ["legacy/**"]
}
```

For the JS variant (executes user code), pass `--allow-config-js` or
set `UBON_ALLOW_CONFIG_JS=1`.

## Documentation

- [docs/CLI.md](docs/CLI.md) — every command and flag
- [docs/RULES.md](docs/RULES.md) — full rule glossary
- [docs/CONFIG.md](docs/CONFIG.md) — config file schema
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Cursor / Lovable / comparison
- [docs/MCP.md](docs/MCP.md) — Model Context Protocol server
- [docs/ADVANCED.md](docs/ADVANCED.md) — profiles, suppressions, baselines, output schemas, release policy
- [MIGRATION-v3.md](MIGRATION-v3.md) — upgrading from v2.x
- [CHANGELOG.md](CHANGELOG.md) — release history

## Requirements

- Node.js **20 or newer** (v3 dropped Node 16/18)
- Git (for `--git-changed-since` and the `git-history` scanner)
- Optional: `@modelcontextprotocol/sdk` for `ubon mcp` — installed
  automatically as an `optionalDependency` of `ubon`. If your install
  flags skipped it, see [`docs/MCP.md`](docs/MCP.md#install).

Run `ubon doctor` to verify.

## About

I'm [Luisfer Romero Calero](https://lfrc.me). I built Ubon because the
gap between "AI shipped this" and "this is safe to deploy" keeps
widening. The tool's name comes from the lotus (อุบล) in Thai —
clarity in the middle of vibe-coded chaos.

If Ubon helps you ship safer apps, the highest praise is to wire it
into your CI and your AI assistant — and tell me what it caught.

## License

MIT — see [LICENSE](LICENSE).
