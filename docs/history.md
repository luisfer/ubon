# History

Ubon started in August 2025 as a pre-commit scanner for Next.js projects. Version 4 is a rewrite with a different job: it checks the work of coding agents while they work. This page summarizes versions 1 to 3 and explains why 4 does not build on them.

The last v3 release is tagged [`v3.2.3`](https://github.com/luisfer/ubon/tree/v3.2.3). Its code and changelog are there.

## Version 1 (August to October 2025)

1.0.0 (2025-08-23) scanned React, Next.js, Vue, and Python projects for hardcoded keys, `eval` and `dangerouslySetInnerHTML`, missing cookie flags, accessibility problems such as images without `alt`, and `fetch` calls without a timeout. It used the TypeScript compiler at runtime to parse code. 1.2.0 (2025-10-13) added a profile for apps exported from Lovable (React, Vite, Supabase): row level security checks, Supabase keys in client code, and Vite environment variables.

## Version 2 (February 2026)

2.0.0 (2026-02-01) added rules for code written by AI assistants: imports of packages missing from `package.json`, repeated code blocks, placeholder implementations, and unused exports. It also added a 0 to 100 "security posture score", fix previews, `ubon explain`, and a Cursor integration.

## Version 3 (April to May 2026)

3.0.0 (2026-04-18) moved to Node.js 20, added rules for LLM features (API keys, prompt injection sinks, unbounded model calls), rules for several frameworks, an MCP server, and Cursor hooks. 3.1.0 added React, Next.js App Router, and agent settings rules. 3.2.0 (2026-05-12) added `ubon agent install`, which generated hook files for Cursor, Claude Code, and Codex. The last release, 3.2.3, had 155 rules, 17 commands, and about 50 flags on `check`.

## Why 4 is a rewrite

An audit in September 2026 ran v3.2.3 against its own documentation and against real projects. Several documented features had never worked:

- The MCP server returned unmasked secrets to the model. The CLI masked the same values.
- The Cursor after-edit hook used an event whose output Cursor ignores, and it compared absolute paths with relative ones, so every edit returned zero findings.
- The prompt hook answered with a field that Cursor ignores for that event, so it never blocked a prompt.
- Changed-file mode used `git diff --name-only`, which skips untracked files, the files an agent creates most often.
- `check` sent HTTP requests to URLs found in the scanned code and wrote a cache into the scanned project.
- On `vercel/ai-chatbot`, Vercel's reference AI app, `ubon check --fast` reported 40 findings and failed the run. Most were false positives, and two rules gave advice that made code worse: one told agents to stop importing Server Actions into client components (the documented pattern), and one reported Drizzle's parameterized `sql` template as injection, which pushes toward `sql.raw()`.
- The package installed 168 packages (about 66 MB), and `npm audit` reported 8 known vulnerabilities in its dependency tree. No v3 release carried an npm provenance attestation.

The v3 tests (230 of them) called internal functions with inline strings, so none of these problems showed up. Fixing them one by one would have kept a large surface that was hard to test. Version 4 keeps what v3 learned (the provider key formats, the list of agent config files, the ideas behind the test fixtures, and the bug list above as regression tests) and replaces the code.

## What changed in 4

| | v3.2.3 | 4.0 |
| --- | --- | --- |
| Job | Scan a repository and list issues | Check what an agent changed and ran, inside the agent loop |
| Runs in | CLI, Cursor hooks (bash), MCP, VS Code | Hooks for Claude Code, Codex, Cursor, Gemini CLI, and GitHub Copilot; git hooks; CI; MCP |
| Default scope | Whole repository | The changes since the base branch, or since the agent session started |
| Rules | 155, many advisory | About 90, each with fixtures; `block` only for precise invariants |
| Install size | 168 packages, about 66 MB | One package, no dependencies, under 2 MB |
| Network | Link checks and OSV lookups by default | None unless `--online` |
| Output | Text with a posture score, JSON, SARIF | Text, an agent format, JSON with a schema, SARIF, Markdown |
| Node.js | 20 or newer | 22.18 or newer |

Rule IDs changed from codes such as `SEC030` to names such as `web/ssrf`. The v3 configuration file (`ubon.config.json`), profiles, presets, the posture score, the LSP server, the VS Code extension, and the Lovable profile are gone. [compatibility.md](compatibility.md) lists what 4 supports.
