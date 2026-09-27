# Ubon

Ubon checks the work of coding agents. It runs inside Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, git hooks, and CI, and looks at what the agent changed and the commands it runs. It stops the agent when it leaks a secret, exposes data, adds a risky package, runs a destructive command, or weakens the tests.

Ubon is deterministic and runs locally. It has no dependencies, calls no language model, and makes no network requests unless you ask it to.

<!-- ubon:demo:begin -->
```text
$ npx ubon check
ubon 4.0.0-alpha.0: 2 changed files since main

block  web/ssrf  app/api/preview/route.ts:6
       fetch() uses a URL from the request body (url, line 5).
       5   url comes from the request body
       6   reaches fetch()
       Fix: Parse the URL with new URL() and check its hostname against an allowlist before fetching, or build the URL from a fixed base and pass the value only as a path segment or query parameter.

block  secret/provider-key  lib/openai.ts:3
       OpenAI API key in source: sk-proj-...MsGg.
       3   export const openai = new OpenAI({ apiKey: 'sk-proj-...MsGg' });
       Fix: Move it to an environment variable (for example process.env.OPENAI_API_KEY) and rotate the key, because it is exposed.

2 blocking.
```

The exit code is 1 because there are blocking findings. This output is generated from [fixtures/demo](fixtures/demo), where `before/` is the base commit and `after/` is what an agent changed.
<!-- ubon:demo:end -->

## Add it to your agent

Ubon needs Node.js 22.18 or newer.

| Agent | Install |
| --- | --- |
| Claude Code | `/plugin marketplace add luisfer/ubon`, then `/plugin install ubon@ubon` |
| Codex | `npx ubon@4 init --codex --yes` |
| Cursor | `npx ubon@4 init --cursor --yes` |
| Gemini CLI | `npx ubon@4 init --gemini --yes` |
| GitHub Copilot (CLI and cloud agent) | `npx ubon@4 init --copilot --yes` |
| Other agents with skills | `npx skills add luisfer/ubon` |
| Git pre-commit and GitHub Actions | `npx ubon@4 init --git-hooks --github --yes` |

Without `--yes`, `ubon init` prints what it would change and writes nothing. For faster hooks and a version pinned by your lockfile, add Ubon as a dev dependency first (`npm install --save-dev ubon`). After installing, `npx ubon doctor` shows whether the hooks are firing.

Version 4 is in alpha. Until 4.0.0 is published, use `ubon@next` in place of `ubon@4`.

## What happens in an agent session

- Before a command runs, Ubon checks it. `rm -rf` outside the project, `git push --force`, `git commit --no-verify`, and secrets piped to the network are denied or sent to you for approval. Package installs are checked against popular package names for typos; with `packages.online` in `ubon.json`, also for packages that do not exist or were published hours ago.
- After each edit, Ubon checks the edited files and tells the agent what it found, with the rule, the line, and a fix.
- When the agent tries to finish, Ubon checks everything it changed in the session. A `block` finding sends the agent back to fix it. Findings that were already in the code before the session are reported, not blocked.
- Prompts that contain a provider key are stopped before they reach the model (in every agent above except GitHub Copilot, which ignores the answer of prompt hooks).

If Ubon itself fails, the hook lets the agent continue and prints a message. [docs/agents.md](docs/agents.md) describes what agents are told to do with each finding.

## What it checks

| Pack | Examples |
| --- | --- |
| `secret` | provider keys in code, config, and prompts; secrets behind `NEXT_PUBLIC_` and `VITE_`; committed `.env` files and private keys |
| `web` | SQL and command injection, SSRF, path traversal, open redirects, unverified webhooks and JWTs, credentialed CORS wildcards |
| `data` | Supabase tables without row level security, permissive policies, service role keys in the browser, Firebase rules in test mode |
| `llm` | API keys in the browser, model output reaching `eval` or SQL, tools with unrestricted shell or file access |
| `deps` | packages that do not exist, packages published hours ago, names close to popular packages, install scripts |
| `agent` | hidden Unicode in instruction files, `curl \| sh` in hooks and skills, secrets and unpinned servers in MCP config, destructive commands |
| `ci` | issue titles and branch names expanded inside `run` steps, fork code checked out in privileged workflows, long-lived npm tokens in release jobs |
| `integrity` | new `.skip` and `.only`, deleted tests, `@ts-nocheck`, lowered coverage thresholds, removed CI checks, suppressions without a reason |
| `hygiene` | code left out with `// ... rest of the code`, placeholder values and stub functions, copies such as `page-v2.tsx` |

Each rule has fixtures that show what it flags and what it leaves alone. [docs/rules](docs/rules/README.md) lists every rule with its examples, and `ubon explain <rule>` prints one.

## Commands

| Command | What it does |
| --- | --- |
| `ubon check` | Check the changes since the base branch, including new files. `--all` checks every file, `--staged` checks what the next commit records. |
| `ubon init` | Set up agents, git hooks, and CI. Dry run unless `--yes`. |
| `ubon vet <package...>` | Check packages before you install them. |
| `ubon map` | List entry points, their auth checks, data access, environment variables, and model calls. |
| `ubon explain <rule>` | Show what a rule checks, why, how to fix it, and tested examples. |
| `ubon rules` | List rules and their levels. |
| `ubon baseline` | Record existing findings so `ubon check --all` reports only new ones. |
| `ubon doctor` | Check the installation and recent hook activity. |
| `ubon mcp` | Run the MCP server for clients without shell access. |
| `ubon hook <agent> <event>` | Handle one hook event. `ubon init` writes these for you. |

Exit codes: 0 when there is no `block` finding, 1 when there is one, 2 for a usage or configuration error, 3 when Ubon fails. `--format` selects `text`, `agent`, `json`, `sarif`, or `markdown`; see [docs/output.md](docs/output.md).

## What it does not do

- It does not prove that your app is secure. It checks specific rules, and every report lists what it could not check.
- It does not replace ESLint, TypeScript, your tests, or `npm audit`.
- It is not a sandbox. Command checks catch mistakes and obvious attacks. Use your agent's sandbox for containment.
- It does not edit your code. The agent makes the fixes.
- It does not send your code anywhere.

## Configuration

Ubon works without configuration. To change a rule's level, skip files, or name your own auth helpers, create `ubon.json`. [docs/config.md](docs/config.md) lists every key.

```json
{
  "$schema": "./node_modules/ubon/schema/config.json",
  "rules": { "hygiene/*": "off" },
  "ignore": ["legacy/**"]
}
```

A finding that is wrong for your code can be suppressed with a comment that says who decided and why:

```ts
// ubon-ignore web/ssrf: user confirmed: the URL comes from our own config table
```

## For agents

If you are an AI agent working in a repository that uses Ubon, read [docs/agents.md](docs/agents.md). In short: run `ubon check` before you say a task is done, fix every `block` finding, run `ubon vet` before you install a package, and never suppress a finding or edit `ubon.json` without the user's agreement. [llms.txt](llms.txt) indexes the docs.

## Docs

- [Getting started](docs/getting-started.md): install Ubon and watch it stop an agent in an example app.
- Integrations: [Claude Code](docs/integrations/claude-code.md), [Codex](docs/integrations/codex.md), [Cursor](docs/integrations/cursor.md), [Gemini CLI](docs/integrations/gemini-cli.md), [GitHub Copilot](docs/integrations/github-copilot.md), [other agents](docs/integrations/other-agents.md).
- [CI and the GitHub Action](docs/ci.md), [MCP server](docs/mcp.md), [configuration](docs/config.md), [output formats](docs/output.md).
- [How it works](docs/how-it-works.md), [security of Ubon itself](docs/security.md), [compatibility](docs/compatibility.md).
- [Upgrade from Ubon 3](docs/upgrade.md) and [history](docs/history.md).

## Security

How Ubon handles your code, what it sends where, and how releases are built and verified: [docs/security.md](docs/security.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Contributing

[AGENTS.md](AGENTS.md) explains how to build, test, and add a rule. Report false positives at https://github.com/luisfer/ubon/issues with the smallest code that triggers them.

## About the name

Ubon (อุบล) is Thai for lotus.

## License

MIT
