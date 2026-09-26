# Gemini CLI

## Install

```
npx ubon init --gemini --yes
```

This adds hooks to `.gemini/settings.json`, writes the skill in `.agents/skills/ubon/`, adds the Ubon block to `AGENTS.md`, and adds `AGENTS.md` to `context.fileName` so Gemini reads it. Gemini fingerprints project hooks: trust them again after they change.

## Hooks

| Event | What Ubon does |
| --- | --- |
| `SessionStart` | Records the session base. |
| `BeforeAgent` | Blocks a prompt that contains a provider key. |
| `BeforeTool` (`run_shell_command`, `read_file`, `read_many_files`, `write_file`, `replace`) | Command checks, sensitive reads, and content checks before writes. |
| `AfterTool` (`write_file`, `replace`, `run_shell_command`) | Checks edited files and returns findings as context. |
| `AfterAgent` | Checks the session's changes; blocking findings make Gemini continue. |

## Limits

- Gemini has no "ask" decision; Ubon denies with instructions for the person.
- Timeouts in Gemini's config are milliseconds; the generated config sets them.

## Check that it works

`npx ubon doctor`.
