# Codex

## Install

```
npx ubon init --codex --yes
```

This writes `.codex/hooks.json`, the skill in `.agents/skills/ubon/`, and the Ubon block in `AGENTS.md`. Codex asks you to review and trust the hooks once with `/hooks`, and again whenever the file changes.

## Hooks

| Event | Matcher | What Ubon does |
| --- | --- | --- |
| `SessionStart` | | Records the session base. |
| `UserPromptSubmit` | | Blocks a prompt that contains a provider key. |
| `PreToolUse` | `Bash\|apply_patch` | Command checks; for patches, key and hidden Unicode checks on the added text and protected-path checks. |
| `PostToolUse` | `Bash\|apply_patch` | Checks the files the patch changed and returns blocking findings. |
| `Stop` | | Checks everything changed in the session. |

## Limits

- Codex validates hook output strictly: one unknown field and it discards the whole output. Ubon's Codex adapter emits only the documented fields for each event; the tests check the exact keys.
- `PreToolUse` supports allow and deny only. When Ubon would ask a person (for example before `git push --force`), Codex gets a denial whose reason says how to allow it: run the command yourself, or add it to `commands.allow` in `ubon.json`.
- Codex has no read tool, so reads of `.env` files are caught only when they go through a shell command such as `cat`.

## Check that it works

`npx ubon doctor` checks `.codex/hooks.json` and shows recent hook activity.
