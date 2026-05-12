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
ubon rules list --json           # machine-readable rule catalog
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

## v3.2.0 — what's new

v3.2.0 is an additive release for agentic development workflows: installable
guardrails, richer machine-readable output, and a validation harness that
proves Ubon catches planted AI-era bugs before a release ships.

- **Agent harness installer**: `ubon agent install --all --write` can generate
  Cursor, Claude Code, Codex, pre-commit, GitHub Actions, and `.gitignore`
  harness files from one dry-run-first workflow.
- **Expanded Cursor hooks**: templates now cover file edits, shell commands,
  MCP calls, prompt submission, stop gates, and pre-compaction context.
- **Agent-specific rules** (`CC009`–`CC011`): catches unknown Cursor hook
  events, broad agent autonomy, and dangerous reusable commands / skills.
- **Agent-ready CLI**: `ubon changed`, `ubon verify`, `ubon review`,
  `ubon rules list --json`, and presets for `agent`, `ci`, `release`, and
  `local` workflows.
- **MCP upgrade**: tools for changed-file scans, `baseSha`, verification,
  status, rule catalog access, and fix planning.
- **Repair context**: JSON / MCP output can include source context so agents
  have enough local evidence to patch findings.
- **Validation harness**: fixture benchmarks, CLI/MCP contract tests,
  deterministic fix/rescan checks, dogfood, and package dry-run verification
  are wired into `npm run verify:release`.
- **Release discipline**: `npm run dogfood` scans Ubon itself and must pass
  with 0 unsuppressed critical findings before publish.

For the original v3 breaking changes (Node 20+, removed Python / Rails / Vue
profiles), see [MIGRATION-v3.md](MIGRATION-v3.md).

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
ubon agent install --cursor --write   # writes Cursor hooks + rules
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

## What Ubon catches

The demo fixture in [`examples/ai-harness-demo`](examples/ai-harness-demo)
contains the kinds of issues AI agents often leave behind: an LLM key in
source, server-side fetch to a user-controlled URL, a misspelled Cursor hook,
and a reusable agent command that pipes network output into a shell.

```bash
ubon check -d examples/ai-harness-demo --preset local
```

The expected rule IDs are checked by the test suite so the demo stays honest.

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
- [docs/START-HERE.md](docs/START-HERE.md) — two-minute setup and daily commands
- [docs/AGENT-HARNESS.md](docs/AGENT-HARNESS.md) — Cursor / Claude Code / Codex / MCP / hooks
- [docs/AGENT-SEMANTICS.md](docs/AGENT-SEMANTICS.md) — how Ubon models agent events, rules, and gates
- [docs/PROGRAMMATIC.md](docs/PROGRAMMATIC.md) — Node API, JSON/NDJSON, and MCP contracts
- [docs/RULES.md](docs/RULES.md) — full rule glossary
- [docs/CONFIG.md](docs/CONFIG.md) — config file schema
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Cursor / Lovable / comparison
- [docs/MCP.md](docs/MCP.md) — Model Context Protocol server
- [docs/ADVANCED.md](docs/ADVANCED.md) — profiles, suppressions, baselines, output schemas, release policy
- [docs/RELEASE.md](docs/RELEASE.md) — release verification and publish checklist
- [docs/VALIDATION.md](docs/VALIDATION.md) — dogfood, fixtures, contracts, and repair loops
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
