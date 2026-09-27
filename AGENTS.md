# Working on Ubon

Instructions for anyone changing this repository, people and coding agents alike. Ubon's user documentation starts at [README.md](README.md); how an agent should use Ubon in other projects is in [docs/agents.md](docs/agents.md).

## Setup

Node.js 22.18 or newer. Dependencies are for development only; the published package has none.

```sh
npm ci
npm test          # node:test, runs TypeScript directly
npm run typecheck # tsc, no emit
npm run lint      # oxlint, correctness rules
npm run build     # esbuild bundle into dist/
npm run verify    # everything CI runs
```

`.npmrc` disables install scripts. Do not add runtime dependencies. A new development dependency needs a reason in the pull request, because each one runs on the machine that publishes the package.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | engine, scope (git), config, file contexts, findings, masking, suppressions, baseline, sessions |
| `src/lang/` | parsing: JavaScript and TypeScript (Babel), comments, JSON and YAML with line numbers, SQL, shell, TOML |
| `src/rules/<pack>/<rule>.ts` | one file per rule; `src/rules/<pack>/index.ts` registers them |
| `src/hook/` | the hook runtime and one adapter per agent |
| `src/mcp/` | the MCP server |
| `src/cli/` | one file per command |
| `src/report/` | text, agent, JSON, SARIF, and Markdown output |
| `src/online/` | npm registry and OSV clients, loaded only for lookups |
| `skills/ubon/` | the skill and its playbooks |
| `fixtures/rules/<pack>/<rule>/` | rule fixtures |
| `test/` | tests; `test/support/` has the rule tester and helpers |
| `docs/` | user documentation; `docs/rules/` is generated |

## Adding or changing a rule

1. Write the fixture first: `fixtures/rules/<pack>/<rule>/`, a small project with `// expect: <rule>` on each line that must be reported and `// ok: <reason>` on each shape that must not be. Keys and tokens are written as `{{fake:<format>}}` markers (see `test/support/fake-keys.ts`); never commit a key-shaped string.
2. A `block` rule needs at least 4 flagged cases and 5 safe cases. The safe cases matter more: they are the realistic code a careless rule would report.
3. Implement the rule in `src/rules/<pack>/<rule>.ts` with its metadata (`title`, `summary`, `why`, `fix`, `cwe`) and register it.
4. `node --test --test-name-pattern="<pack>/<rule>" test/rules.test.ts` until it passes.
5. Run the rule on real projects and look at every finding. A rule reaches `block` only when it is right almost every time.
6. `npm run gen` regenerates `docs/rules/` and the config schema; commit the result.

## Writing

All text in this repository follows [docs/style.md](docs/style.md): no em dashes, no marketing words, numbers instead of adjectives, sentence-case headings. Rule messages are one sentence each for the problem and the fix. `npm run lint:prose` checks the mechanical part.

## Before you push

- `npm run verify` passes.
- New behavior has a test that would fail without it.
- Generated files are committed (`npm run check:gen`).
- No key-shaped strings, and no changes to `.github/workflows/` without a reason in the pull request.
