# GitHub Copilot

Copilot runs hooks in three places: Copilot CLI, the cloud agent, and the VS Code agent.

## Install

```
npx ubon init --copilot --yes
```

This writes `.github/hooks/ubon.json`, the skill in `.agents/skills/ubon/`, and the Ubon block in `AGENTS.md`. The cloud agent reads hooks only from `.github/hooks/`. Add Ubon as a dev dependency so the cloud agent's sandbox does not download it for every hook.

The hooks use PascalCase event names (`PreToolUse`, `PostToolUse`, `Stop`), which both Copilot CLI and VS Code read. Registering both naming styles makes Copilot CLI run each hook twice.

## Hooks

| Event | What Ubon does |
| --- | --- |
| `SessionStart` | Records the session base. |
| `PreToolUse` | Command checks, sensitive reads, and content checks before writes. |
| `PostToolUse` | Checks edited files and returns findings as context. |
| `Stop`, `SubagentStop` | Checks the session's changes; blocking findings make the agent continue. |

## Limits

- A `preToolUse` command hook that crashes or exits with an error denies the tool call. Ubon always exits 0 with an explicit output, including when it fails internally.
- Copilot CLI drops the output of prompt hooks, so prompts with keys cannot be blocked there.
- The cloud agent has no person to ask: `ask` becomes a denial.
- Copilot CLI also reads `.claude/settings.json`. If both files register Ubon, events run twice; the decisions are the same.

## Check that it works

`npx ubon doctor`.
