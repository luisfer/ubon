# Agent Harness

Ubon can sit in the agent loop instead of waiting for a final manual scan.

## Cursor

```bash
ubon agent install --cursor --write
```

This writes `.cursor/hooks.json`, hook scripts, and `.cursor/rules/ubon.mdc`.
The generated hooks scan after edits, guard risky shell and MCP actions, and
ask the agent to continue if critical changed-file findings remain at stop.

## Claude Code

```bash
ubon agent install --claude --write
```

This writes concise `CLAUDE.md` guidance. Use the same commands in Claude Code
hooks if you manage `.claude/settings.json` yourself:

```bash
ubon check --preset agent
ubon verify
ubon review --since origin/main
```

## Codex

```bash
ubon agent install --codex --write
```

This writes `AGENTS.md` guidance that tells Codex when to run Ubon and what
counts as done.

## MCP

Add the Ubon MCP server to your agent:

```json
{
  "mcpServers": {
    "ubon": {
      "command": "npx",
      "args": ["-y", "ubon@latest", "mcp"]
    }
  }
}
```

Useful tools:

- `ubon.check`: fast static scan.
- `ubon.verify`: compact gate for hooks and stop events.
- `ubon.plan-fixes`: ordered fix plan without writes.
- `ubon.rule-catalog`: machine-readable rule catalog.
- `ubon.status`: harness and config status.

`ubon.apply-fixes` defaults to dry-run. Pass `apply: true` only after review.

## Pre-commit and CI

```bash
ubon agent install --pre-commit --github --write
```

Pre-commit should use `ubon verify` or `ubon check --preset ci`. CI should run
the same command so local and remote gates agree.
