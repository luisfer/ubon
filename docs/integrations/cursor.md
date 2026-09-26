# Cursor

## Install

```
npx ubon init --cursor --yes
```

This writes `.cursor/hooks.json` (merged with your hooks), the skill in `.agents/skills/ubon/`, and the Ubon block in `AGENTS.md`.

## Hooks

| Event | What Ubon does |
| --- | --- |
| `sessionStart` | Records the session base. |
| `beforeSubmitPrompt` | Blocks a prompt that contains a provider key (`continue: false`). |
| `beforeShellExecution` | Command checks. |
| `beforeReadFile` | Denies reads of `.env` files and private keys. |
| `preToolUse` (Write) | Key, hidden Unicode, and protected-path checks on the content. |
| `postToolUse` (Write, Shell) | Checks edited files and returns findings as context; scans shell output for keys. |
| `stop` | Checks the session's changes and sends blocking findings as a follow-up message. |

## Limits

- `afterFileEdit` cannot return anything to the agent, so Ubon uses `postToolUse` for feedback after edits.
- In Cursor 3.9, `permission: "ask"` behaved like a silent deny. Ubon puts the full explanation, including how a person can allow the action, in both `user_message` (which the model receives) and `agent_message`.
- The stop hook sends at most `loop_limit` follow-ups (3 in the generated config); Ubon's own loop guard stops after two attempts for the same findings.

## Check that it works

`npx ubon doctor`.
