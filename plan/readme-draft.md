<!-- Draft of the Ubon 4 README, part of the plan in README.md. Links point to files that will exist in the new tree. -->

# Ubon

Ubon checks the work of coding agents. It runs inside Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, and CI, and looks at what the agent changed. It stops the agent when it leaks a secret, exposes data, adds an untrusted package, runs a destructive command, or weakens the tests.

It is deterministic, runs locally, installs no dependencies, and sends nothing over the network unless you ask it to.

```
$ npx ubon@4 check
ubon 4.0.0: 7 changed files since origin/main (0.4 s)

block  web/ssrf  app/api/preview/route.ts:12
       fetch() uses a URL from the request body.
       Fix: check the host against an allowlist before fetching.

block  secret/provider-key  lib/openai.ts:3
       OpenAI key in source: "sk-proj-...a1B2".
       Fix: read it from process.env.OPENAI_API_KEY, then rotate the key.

2 blocking. Not checked: registry lookups (offline).
```

## Add it to your agent

| Agent | Install |
| --- | --- |
| Claude Code | `/plugin marketplace add luisfer/ubon`, then `/plugin install ubon@ubon` |
| Codex | `npx ubon@4 init --codex --yes` |
| Cursor | `npx ubon@4 init --cursor --yes` |
| Gemini CLI | `gemini extensions install https://github.com/luisfer/ubon` |
| GitHub Copilot | `npx ubon@4 init --copilot --yes` |
| Anything with skills | `npx skills add luisfer/ubon` |
| Git and CI | `npx ubon@4 init --git-hooks --github --yes` |

After installing, `ubon doctor` shows whether the hooks are firing.

## What it checks

| Area | Examples |
| --- | --- |
| Secrets | provider keys in code, config, and prompts; secrets behind `NEXT_PUBLIC_` and `VITE_`; committed `.env` files |
| Web security | SQL and command injection, SSRF, path traversal, unverified webhooks and JWTs |
| Data access | Supabase tables without row level security, permissive policies, service role keys in the browser, Firebase rules in test mode |
| LLM features | API keys in the browser, model output reaching `eval` or SQL, tools with unrestricted shell or file access |
| Dependencies | packages that do not exist, packages published hours ago, typosquats, install scripts |
| Agent setup | hidden Unicode in instruction files, `curl \| sh` in hooks and skills, unpinned MCP servers, auto-run tasks |
| Commands | `rm -rf` on the wrong path, `git push --force`, skipped git hooks, secrets piped to the network |
| Test integrity | new `.skip` and `.only`, deleted tests, `@ts-nocheck`, lowered coverage thresholds, CI checks removed |

Every rule, with examples: [docs/rules](docs/rules). How often each rule is right on real projects: [docs/precision.md](docs/precision.md).

## What it does not do

- It does not prove your app is secure. It checks specific rules and says which checks it could not run.
- It does not replace ESLint, TypeScript, your tests, or `npm audit`.
- It is not a sandbox. Command checks catch mistakes and obvious attacks; use your agent's sandbox for containment.
- It does not call a language model or send your code anywhere.

## Configuration

Ubon works without configuration. To change a rule's level or teach it your auth helpers, create `ubon.json`; see [docs/config.md](docs/config.md).

## For agents

If you are an AI agent working in a repository that uses Ubon, read [docs/agents.md](docs/agents.md). Run `ubon check` before you finish, fix every `block` finding, and never suppress one without a reason the user agreed to.

## Security

How Ubon handles your code and how its releases are built and verified: [docs/security.md](docs/security.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## About the name

Ubon (อุบล) is Thai for lotus.

## License

MIT
