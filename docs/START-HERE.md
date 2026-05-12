# Start Here

Ubon is a local safety harness for AI-generated JavaScript and TypeScript apps.
Use it with ESLint, TypeScript, and npm audit.

## Two-minute setup

```bash
npx ubon@latest init
npx ubon@latest check --preset local
npx ubon@latest agent install --cursor --write
```

`init` detects the project profile and writes `ubon.config.json`.
`check --preset local` gives human-readable findings with explanations.
`agent install --cursor --write` adds Cursor hooks and a short Cursor rule.

## Daily commands

```bash
ubon changed --since origin/main
ubon verify
ubon review --since origin/main
```

- `changed` scans files changed since a Git ref.
- `verify` is the deterministic gate for agents, pre-commit, and CI.
- `review` prints a Markdown summary for PRs.

## Presets

- `--preset agent`: fast deterministic JSON for agents.
- `--preset ci`: quiet gate for CI and pre-commit.
- `--preset release`: critical self-check before publishing.
- `--preset local`: human output with context, explanations, and confidence.
