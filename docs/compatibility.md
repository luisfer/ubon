# Compatibility

## Runtime

| Requirement | Supported |
| --- | --- |
| Node.js | 22.18 or newer. CI tests 22.18, 24, and 26. |
| Operating systems | Linux, macOS, and Windows. CI runs the tests on all three. |
| Git | 2.30 or newer, for `ubon check` without `--all` and for session checks. Without git, Ubon checks every file and says so. |
| Package managers | Any. `ubon vet` and the `deps` rules read `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, and `bun.lock`. |

`ubon doctor` checks the Node.js and Git versions.

## Agents

The hook adapters follow each agent's hook documentation or source code. The table lists what they were checked against and the date of the last check. Recorded sessions (`fixtures/sessions/`) replay real payloads through `ubon hook` in the test suite.

| Agent | Checked against | Last checked | Notes |
| --- | --- | --- | --- |
| Claude Code | Hook reference and Claude Code 2.1.283 | 2026-09-26 | Plugin or project hooks. [claude-code.md](integrations/claude-code.md) |
| Codex | `openai/codex` source, commit `1a89aec` | 2026-09-26 | Codex has no "ask" answer; Ubon denies instead and says why. [codex.md](integrations/codex.md) |
| Cursor | Hook reference and hook runs recorded with Cursor 3.9.16 | 2026-09-26 | "Ask" works only before shell commands. [cursor.md](integrations/cursor.md) |
| Gemini CLI | `google-gemini/gemini-cli` source, 0.63.0 nightly of 2026-09-23 | 2026-09-26 | Hook timeouts are in milliseconds. [gemini-cli.md](integrations/gemini-cli.md) |
| GitHub Copilot | Hooks reference in `github/docs`, commit `18945a3` | 2026-09-26 | Copilot CLI and the cloud agent. Prompt hooks cannot block. [github-copilot.md](integrations/github-copilot.md) |

Agents without hooks use the skill, the `AGENTS.md` block, git hooks, and CI. See [other-agents.md](integrations/other-agents.md).

When an agent changes its hook format, `ubon hook` fails open: the agent continues, and the message names the event Ubon could not read. Report it at https://github.com/luisfer/ubon/issues with the output of `ubon hook <agent> <event> --record payload.jsonl`, which masks secrets before it writes.

## MCP clients

`ubon mcp` speaks MCP over stdio. It answers the `initialize` handshake for protocol versions 2024-11-05, 2025-03-26, 2025-06-18, and 2025-11-25, and the stateless 2026-07-28 revision (`server/discover`). See [mcp.md](mcp.md).

## Frameworks and languages

Rules read JavaScript and TypeScript (including JSX, Vue, Svelte, and Astro script blocks), SQL migrations, Firebase rules, JSON, YAML, TOML, Markdown, `.env` files, and shell scripts inside hooks and workflows. Framework-aware rules know Next.js (App Router and Pages Router), Vite, SvelteKit, Remix and React Router, Astro, Nuxt, Express, Fastify, Hono, Supabase, Firebase, Prisma, and Drizzle. Code in other languages is checked only by the language-independent rules, such as `secret/provider-key`.
