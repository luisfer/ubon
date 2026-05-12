# Agent Semantics

Ubon treats agent workflows as a harness: instructions, tools, hooks, permissions,
and verification gates. The goal is not to replace human review. The goal is to
make unsafe agent output harder to merge unnoticed.

## Events Worth Gating

- Before shell execution: block obvious destructive or secret-leaking commands.
- After shell execution: scan debug output for leaked tokens and suspicious URLs.
- Before MCP execution: detect broad tool access and literal secrets in tool args.
- After MCP execution: inspect returned content for credentials and unsafe code.
- After file edits: scan changed files while the agent still has context.
- Before submit prompt: include recent Ubon status in the next agent turn.
- Stop: run a final cheap gate before the agent declares work complete.
- Pre-compact: preserve Ubon status before context is summarized away.

Cursor exposes these as hook events. Claude Code and Codex use different shapes,
but the same principle applies: scan small, changed surfaces during the loop and
run a stricter gate before commit or release.

## Rule Families

- `AI*`: LLM application risks such as prompt injection, exposed keys, unsafe
  tool calls, and unauthenticated streaming routes.
- `CC*`: agent harness risks such as unknown Cursor hook events, broad autonomy,
  dangerous reusable commands, and unsafe MCP configuration.
- `SEC*`: application security risks that AI-generated code frequently ships.
- `NEXT*`, `EDGE*`, and framework rules: deployment and runtime mistakes.
- `VIBE*`: hallucinated imports and code that looks plausible but is not wired.

## Defaults For Agents

Agents should start with:

```bash
ubon changed --json --quiet
```

Before commit or PR, agents should run:

```bash
ubon verify --preset ci
```

Before release, maintainers should run:

```bash
npm run verify:release
```

If a finding is intentional, suppress it near the code with a rule-specific
comment and a short reason. Do not hide whole categories unless the repository
has another tool that owns that risk.
