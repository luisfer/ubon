# Claude Code

## Install

The plugin is the recommended install. The Ubon repository is its own plugin marketplace:

```
/plugin marketplace add luisfer/ubon
/plugin install ubon@ubon
```

The plugin runs the Ubon version bundled in it, with no download at hook time. It adds the hooks below, the `ubon` skill, the commands `/ubon:check`, `/ubon:finish`, `/ubon:review`, and `/ubon:vet`, and a read-only `ubon-reviewer` subagent.

For a team, `npx ubon init --claude --yes` adds the marketplace and the plugin to the committed `.claude/settings.json`, so everyone who trusts the folder is asked to install it:

```json
{
  "extraKnownMarketplaces": {
    "ubon": { "source": { "source": "github", "repo": "luisfer/ubon" } }
  },
  "enabledPlugins": { "ubon@ubon": true }
}
```

Without the plugin, `npx ubon init --claude --hooks-only --yes` writes the same hooks into `.claude/settings.json` (merged; other hooks stay) and the skill into `.claude/skills/ubon/`. Hooks then run the project's dev dependency (`npx --no-install ubon`), or a pinned version when Ubon is not installed in the project.

## Hooks

| Event | What Ubon does |
| --- | --- |
| `SessionStart` | Records the session base and tells the agent Ubon is active. |
| `UserPromptSubmit` | Blocks a prompt that contains a provider key, before it reaches the model. |
| `PreToolUse` (Bash, PowerShell) | Command checks: destructive commands, secret exfiltration, skipped git hooks, remote scripts, package installs, publish and deploy commands. |
| `PreToolUse` (Read) | Asks before `.env` files and private keys are read into the conversation. |
| `PreToolUse` (Edit, Write, NotebookEdit) | Denies content with a provider key (unless the file is git-ignored) and hidden Unicode in agent files; asks before changes to Ubon's config, hook settings, and CI workflows. |
| `PostToolUse` (Edit, Write, NotebookEdit) | Checks the edited file and returns blocking findings to the agent at once. |
| `PostToolUse` (Bash, PowerShell) | Logs the command; tells the agent not to repeat a key that appeared in the output. |
| `Stop`, `SubagentStop` | Checks everything changed in the session. Blocking findings make the agent continue and fix them; after two attempts for the same findings it may stop, and they are recorded as unresolved. |

## CLAUDE.md and AGENTS.md

Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`. `ubon init` never creates `CLAUDE.md`. If one exists, it adds an `@AGENTS.md` line so Claude Code also reads the Ubon block in `AGENTS.md`.

## Plugin options

When you enable the plugin, you can set the stop behavior (`block` or `warn`) and registry lookups for install commands. They apply only where the project's `ubon.json` says nothing.

## Check that it works

Run `ubon doctor` (or `npx ubon doctor`). After a session, it shows the hook events Ubon handled, from the session log in `.git/ubon/`.

## Next to Anthropic's security plugins

Anthropic's `security-guidance` plugin warns on edits and runs a model review at the end of turns; `/security-review` reviews a branch with the model. Ubon runs deterministic checks that can block, the same way in every agent, including package, command, and test-integrity checks. They work together.
