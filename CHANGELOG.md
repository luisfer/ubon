# Changelog

Notable changes to Ubon, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Ubon follows [semantic versioning](https://semver.org/) for its commands and options, exit codes, `ubon.json`, the JSON report, hook behavior, and the programmatic API. New `warn` rules can arrive in minor releases; a new `block` rule is listed first in the notes of the release that adds it.

Releases before 4.0 are summarized in [docs/history.md](docs/history.md). Their full changelog is in the [`v3.2.3` tag](https://github.com/luisfer/ubon/blob/v3.2.3/CHANGELOG.md).

## [Unreleased]

## [4.0.0-alpha.0]

Ubon 4 is a rewrite. It checks what coding agents change and run, from inside their hooks, in git hooks, and in CI. [docs/upgrade.md](docs/upgrade.md) lists what to change when you come from Ubon 3, and `ubon init` removes the files that Ubon 3 installed.

### Added

- `ubon check` checks the changes since the base branch, including untracked files, and reports only what the change introduced. `--all` checks every file, `--staged` checks what a commit will record, and paths check just those files.
- Rules in nine packs: `secret`, `web`, `data`, `llm`, `deps`, `agent`, `ci`, `integrity`, and `hygiene`. Each rule reports `block` or `warn` and has fixtures that show what it flags and what it leaves alone. `ubon rules` lists them and `ubon explain <rule>` shows one with its examples.
- `ubon hook <agent> <event>` for Claude Code, Codex, Cursor, Gemini CLI, and GitHub Copilot. Hooks check commands before they run (destructive commands, force pushes, skipped git hooks, package installs), check each edit after it is written, and stop the agent from finishing while a `block` finding in its own changes remains. They fail open with a visible message if Ubon itself fails.
- `ubon init` sets up the agents it finds, a git pre-commit hook, and a GitHub Actions workflow. It shows a plan and writes only with `--yes`; `--remove` undoes it.
- A Claude Code plugin (this repository is its marketplace) with the hooks, the `ubon` skill, the `/ubon:check`, `/ubon:finish`, `/ubon:review`, and `/ubon:vet` commands, and a reviewer subagent that reports without editing.
- The `ubon` skill for agents that read skills, with playbooks for finishing a task, triaging findings, adding a dependency, handling secrets, data access, LLM features, and reviews.
- `ubon vet <package...>` checks packages before an install: whether they exist, their age and the age of the version, install scripts, known vulnerabilities (OSV), and names close to popular packages.
- `ubon map` lists entry points (routes, Server Actions, webhooks), whether each checks auth, the data it reads and writes, the environment variables it uses, and model calls.
- `ubon mcp`, an MCP server over stdio with the read-only tools `check`, `explain`, `map`, and `vet`. It serves both the `initialize` handshake and the 2026-07-28 revision.
- `ubon doctor` shows the Node version, the integrations found, and recent hook activity.
- `ubon baseline` records existing findings in `.ubon/baseline.json` so `ubon check --all` reports only new ones.
- Output formats: text for terminals, a compact format for agents (chosen automatically inside agent shells), JSON with a published schema, SARIF 2.1.0, and Markdown for job summaries.
- A GitHub Action (`luisfer/ubon`), and a hook for the pre-commit framework.
- Suppression comments that name the rule, who decided, and the evidence: `ubon-ignore <rule>: <who>: <evidence>`.
- Friendly errors for Ubon 3 commands and options, each naming its replacement.

### Changed

- Rule IDs are names such as `web/ssrf` instead of codes such as `SEC030`.
- The configuration file is `ubon.json`, validated against `schema/config.json`. Ubon never runs a JavaScript config file.
- Ubon makes no network requests unless you pass `--online`, set `packages.online`, or run `ubon vet`.
- Ubon writes into the project only when you run `ubon init --yes` or `ubon baseline`, or name an output file. Session state lives in the git directory.
- Node.js 22.18 or newer is required.
- The package has no dependencies. The parser and YAML library are bundled into one file, and the published package is under 1 MB.
- Releases are published from GitHub Actions with npm trusted publishing and provenance.

### Removed

- Everything from Ubon 3 that is not listed above, including profiles, presets, the posture score, confidence scores, interactive and watch modes, fix previews, the link checker and crawler, the LSP server, the VS Code extension, shell completion, and the Lovable profile.
- The `ubon.config.json` and `ubon.config.js` files, the `"ubon"` key in `package.json`, and the `ubon-disable-next-line` and `ubon-disable-file` comments.

[Unreleased]: https://github.com/luisfer/ubon/compare/v4.0.0-alpha.0...HEAD
[4.0.0-alpha.0]: https://github.com/luisfer/ubon/compare/v3.2.3...v4.0.0-alpha.0
