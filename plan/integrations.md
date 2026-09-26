# Ubon 4 integrations (proposal)

How Ubon connects to each coding agent, to git, to CI, and to MCP clients: which files `ubon init` writes, which events Ubon handles, and what it returns. Formats were checked on 2026-09-26 against each agent's documentation or source code; items marked "unverified" came from secondary sources and must be confirmed with a recorded session before release.

Back to the main plan: [README.md](README.md).

## 1. Design rules for every integration

1. One entry point. Every agent hook runs `ubon hook <agent> <event>`, which reads the event JSON from stdin and prints the exact output that agent expects. Generated config files contain nothing but the command. All logic lives in versioned, tested code. v3 put it in bash scripts, which did not run on Windows and failed silently elsewhere.
2. Explicit agent and event. Both are passed on the command line. The payload's event name is checked against them. Ubon never guesses the agent from environment variables for hook output, because several agents read each other's config files (Copilot CLI reads `.claude/settings.json`; Cursor can load Claude Code hooks) and would get the wrong output shape.
3. Exact output schemas. Codex rejects the whole output if it contains one unknown field. Cursor reads flat snake_case fields and ignores `hookSpecificOutput`. Copilot CLI reads a top-level `additionalContext`, VS Code a nested one. Each adapter has its own output builder and golden tests.
4. Fail open, and exit 0 on errors. Copilot treats a crashing `preToolUse` hook as a deny; other agents let the action through. Ubon catches every internal error, prints an explicit allow in the agent's format plus a visible warning, and exits 0. It only blocks through the agent's documented decision field (or exit code 2 where that is the only mechanism).
5. Idempotent. When the same event reaches Ubon twice (an agent reading two config files), the second call with the same `tool_use_id` or equivalent returns the first decision from the session log.
6. Self-filtering. Some hosts ignore matchers (VS Code ignores them in Claude-format files), so every adapter checks `tool_name` itself and returns allow for tools it does not handle.
7. Pinned Ubon, fast start. The command that runs Ubon is, in order of preference:
   - the copy bundled inside a plugin (`node "${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs" ...`): no network, pinned by the plugin version;
   - the project's dev dependency run directly with `node` (about 35 ms to start);
   - `npx --no-install ubon ...` when the hook runs from a subdirectory (about 290 ms, measured, but never downloads);
   - `npx -y ubon@<exact version> ...` as the last resort.
   Never `@latest`, never an unpinned `npx --yes ubon` (v3 did this).
8. Budgets. Hooks that run before an action are kept under 150 ms and do not load the parser unless they must. Hooks that run after an edit only check the edited files. The Stop gate is the only hook that looks at the whole session.

## 2. Capability matrix

What each agent lets a hook do, and what Ubon uses. "Yes" means verified in the agent's docs or source; the recorded-session tests are the final proof.

| Capability | Claude Code | Codex | Cursor | Gemini CLI | GitHub Copilot (CLI, cloud agent, VS Code) |
| --- | --- | --- | --- | --- | --- |
| Before a shell command: deny | yes (`PreToolUse`) | yes (`PreToolUse` on `Bash`) | yes (`beforeShellExecution`, `preToolUse`) | yes (`BeforeTool` on `run_shell_command`) | yes (`preToolUse`) |
| Before a shell command: ask the human | yes (`ask`) | no (`ask` makes the hook fail) | documented, but observed to behave like deny (Cursor 3.9.16) | no | CLI yes; cloud agent treats `ask` as deny |
| Before a file read | yes (`PreToolUse` on `Read`) | no read tool hook | yes (`beforeReadFile`) | yes (`BeforeTool` on `read_file`) | yes (`preToolUse` on `view`) |
| Before a file write (content visible) | yes | yes (`apply_patch` text) | yes (`preToolUse` on `Write`) | yes | yes |
| After an edit: feedback to the agent | yes (`PostToolUse`, `decision: block` or `additionalContext`) | yes (`PostToolUse`) | yes via `postToolUse` (`additional_context`); `afterFileEdit` cannot return anything | yes (`AfterTool`) | yes (`postToolUse`) |
| Stop gate (make the agent continue) | yes (`Stop`, `decision: block`; host cap of 8 continuations) | yes (`Stop`, `decision: block`) | yes (`stop`, `followup_message`; `loop_limit`) | yes (`AfterAgent`, `decision: deny`) | yes (`agentStop`, `decision: block`; cap of 8) |
| Prompt check | yes (`UserPromptSubmit`, block) | yes (`UserPromptSubmit`, context only) | yes (`beforeSubmitPrompt`, `continue: false`) | yes (`BeforeAgent`) | yes (`userPromptSubmitted`) |
| Session start record | yes (`SessionStart`) | yes | yes (`sessionStart`) | yes | yes |
| Skills | `.claude/skills/`, plugin `skills/` | `.agents/skills/` | `.cursor/skills/`, `.agents/skills/` | `.gemini/skills/`, `.agents/skills/` | `.github/skills/`, `.agents/skills/`, `.claude/skills/` |
| Plugin format | `.claude-plugin/` | `.codex-plugin/` or Agent Plugins 1.0 | `.cursor-plugin/` | extension (`gemini-extension.json`) | Agent Plugins 1.0, also reads `.claude-plugin/` |
| Instructions file | `CLAUDE.md`; `AGENTS.md` only when no `CLAUDE.md` exists | `AGENTS.md` | `AGENTS.md`, `.cursor/rules/` | `GEMINI.md`; `AGENTS.md` when configured | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/` |

Targets for 4.0: Claude Code, Codex, Cursor, git hooks, GitHub Action, MCP. Gemini CLI and Copilot ship in 4.0 if their recorded sessions pass in time, otherwise in 4.1. Every other agent gets the skill, the `AGENTS.md` block, and MCP config in 4.0 (section 8).

## 3. Claude Code

### 3.1 Install

The plugin is the recommended install. The Ubon repository is its own marketplace:

```
/plugin marketplace add luisfer/ubon
/plugin install ubon@ubon
```

For a team, `ubon init --claude` can add this to the committed `.claude/settings.json` so everyone gets the plugin:

```json
{
  "extraKnownMarketplaces": {
    "ubon": { "source": { "source": "github", "repo": "luisfer/ubon" } }
  },
  "enabledPlugins": { "ubon@ubon": true }
}
```

Without the plugin, `ubon init --claude --hooks-only` writes the same hooks into `.claude/settings.json` (merged, never overwriting other hooks) and the skill into `.claude/skills/ubon/`, using the project's dev dependency.

After release, submit the plugin to the Anthropic directory and to the community marketplace (`anthropics/claude-plugins-community`) so users can find it.

### 3.2 Plugin layout

Generated by the build into `integrations/claude-code/`, published through `.claude-plugin/marketplace.json` at the repository root:

```
integrations/claude-code/
  .claude-plugin/plugin.json
  hooks/hooks.json
  skills/ubon/SKILL.md            (plus references/)
  agents/ubon-reviewer.md
  bin/ubon                        (launcher; the plugin's bin/ is added to the Bash tool's PATH)
  dist/ubon.mjs                   (the same single file that is published to npm)
```

```json
{
  "name": "ubon",
  "owner": { "name": "Luisfer Romero Calero" },
  "plugins": [
    {
      "name": "ubon",
      "source": "./integrations/claude-code",
      "description": "Checks what the agent changes and runs: secrets, trust boundaries, packages, commands, weakened tests."
    }
  ]
}
```

`plugin.json` sets `version` to the Ubon version, so users stay on a release until the plugin is updated, and declares `userConfig` for the two settings most people change (`stop`: `block` or `warn`; `online`: `true` or `false`). `bin/ubon` means the agent can run `ubon check` in its shell without installing anything.

### 3.3 Hooks

```json
{
  "description": "Ubon: deterministic checks on agent actions and changes",
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs", "hook", "claude", "SessionStart"], "timeout": 10 } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs", "hook", "claude", "UserPromptSubmit"], "timeout": 5 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash|PowerShell|Read|Edit|Write|NotebookEdit",
        "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs", "hook", "claude", "PreToolUse"], "timeout": 10 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|NotebookEdit|Bash|PowerShell",
        "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs", "hook", "claude", "PostToolUse"], "timeout": 30, "statusMessage": "ubon: checking the change" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs", "hook", "claude", "Stop"], "timeout": 120, "statusMessage": "ubon: checking this session's changes" } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs", "hook", "claude", "SubagentStop"], "timeout": 120 } ] }
    ]
  }
}
```

The `args` form runs without a shell, which the Claude Code docs recommend when paths contain placeholders, and works on Windows. `claude plugin validate --strict` runs in CI on the generated plugin.

| Event | What Ubon does | Output |
| --- | --- | --- |
| `SessionStart` | Records the session base (HEAD plus hashes of already-dirty and untracked files) under `.git/ubon/`. On `source: compact`, re-injects the list of open findings. | `hookSpecificOutput.additionalContext`: one line, for example `ubon is active: changes are checked after edits and before you finish.` |
| `UserPromptSubmit` | Scans `prompt` for provider keys. | `{"decision": "block", "reason": "..."}` telling the user to move the key to `.env`; nothing otherwise. |
| `PreToolUse` on `Bash`/`PowerShell` | Command checks and package vetting. | `hookSpecificOutput.permissionDecision` = `deny` or `ask` with `permissionDecisionReason`; nothing when allowed. |
| `PreToolUse` on `Read` | Sensitive file patterns. | `ask` with the reason. |
| `PreToolUse` on `Edit`/`Write`/`NotebookEdit` | Scans the new content (`content`, `new_string`) for provider keys and hidden Unicode; checks protected paths (`ubon.json`, `.claude/settings.json`, workflows). | `deny` for a key about to be written (the reason says to use an env var), `ask` for protected paths. |
| `PostToolUse` on `Edit`/`Write`/`NotebookEdit` | File rules on the edited file. | `{"decision": "block", "reason": "<agent-format findings>"}` for `block` findings, which Claude Code shows next to the tool result; `hookSpecificOutput.additionalContext` for warnings. |
| `PostToolUse` on `Bash`/`PowerShell` | Appends the command and outcome to the session log; scans `tool_response` for secrets; notes files changed by the command (`bashEditDiff.changedFiles` when present) for the Stop check. | `additionalContext` only if a secret appeared in output. |
| `Stop`, `SubagentStop` | Full session check (file, project, diff rules on everything changed since `SessionStart`), stop policy, loop guard using `stop_hook_active` and the session log. | `{"decision": "block", "reason": "..."}` or nothing. |

Claude Code caps consecutive Stop continuations at 8. Ubon's own loop guard lets the agent stop after two blocks for the same findings and records them as unresolved.

### 3.4 Skill, commands, subagent, instructions

- Skill `ubon` with the playbooks from the main plan (section 6). Commands appear as `/ubon:check`, `/ubon:review`, `/ubon:finish`, `/ubon:vet`.
- Subagent `ubon-reviewer`: read-only tools, runs the `review` playbook with fresh context.
- Instructions: Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`. `ubon init` never creates `CLAUDE.md` (v3 did, which turned off `AGENTS.md` loading). It writes a delimited block into `AGENTS.md`, and if a `CLAUDE.md` exists it offers to add an `@AGENTS.md` import line.
- MCP: available in the plugin but not enabled by default (the CLI is on the agent's PATH, and tool definitions cost context on every turn).

### 3.5 In CI

Teams that already run `anthropics/claude-code-action` can add `plugins: ubon@ubon` and a `/ubon:review` prompt for a model-led review that starts from `ubon map`. This is optional and costs API tokens; the deterministic gate is the Ubon GitHub Action (section 10).

### 3.6 Next to Anthropic's security plugins

Anthropic's `security-guidance` plugin runs pattern warnings on edits and a model review at the end of turns, and none of its layers block. `/security-review` reviews a branch diff with the model. Ubon is compatible with both and does something different: deterministic checks that can block, across agents, including dependency, command, and test-integrity checks. The docs describe how to run them together.

## 4. Codex

### 4.1 Files

`ubon init --codex` writes:

- `.codex/hooks.json` (hooks are stable and enabled by default in current Codex; the user reviews and trusts them once with `/hooks`, and again whenever the file changes),
- `.agents/skills/ubon/` (the skill),
- a delimited Ubon block in `AGENTS.md`,
- optionally `[mcp_servers.ubon]` in `.codex/config.toml`.

A Codex plugin (`.codex-plugin/plugin.json`, or the Agent Plugins 1.0 root `plugin.json` that Codex also accepts) bundles the same pieces with `dist/ubon.mjs`; Codex gives plugin hooks `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT`, so the command can point at the bundled file.

```json
{
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "npx --no-install ubon hook codex SessionStart", "timeout": 10 } ] } ],
    "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "npx --no-install ubon hook codex UserPromptSubmit", "timeout": 5 } ] } ],
    "PreToolUse": [ { "matcher": "Bash|apply_patch", "hooks": [ { "type": "command", "command": "npx --no-install ubon hook codex PreToolUse", "timeout": 10 } ] } ],
    "PostToolUse": [ { "matcher": "Bash|apply_patch", "hooks": [ { "type": "command", "command": "npx --no-install ubon hook codex PostToolUse", "timeout": 60 } ] } ],
    "Stop": [ { "hooks": [ { "type": "command", "command": "npx --no-install ubon hook codex Stop", "timeout": 120 } ] } ]
  }
}
```

### 4.2 Specifics

- File edits arrive as `apply_patch` with the patch text in `tool_input.command`. The adapter parses `*** Add File:`, `*** Update File:`, and `*** Delete File:` headers to find paths, and reads the new content from the patch for pre-write checks.
- Output schemas are strict (`additionalProperties: false`). `PreToolUse` supports `allow` and `deny` only; Ubon maps `ask` to `deny` with a reason that tells the user how to approve (run the command themselves, or add it to `commands.allow` in `ubon.json`). `Stop` accepts only `{"decision": "block", "reason": "..."}`.
- `codex exec` is used by the agent evaluation script, not by users.

## 5. Cursor

### 5.1 Files

`ubon init --cursor` writes `.cursor/hooks.json` (merged with existing hooks), the skill in `.agents/skills/ubon/`, and the `AGENTS.md` block. The v3 rule file `.cursor/rules/ubon.mdc` is not needed once the skill exists; if a rule file is generated, its `globs` must be a bare comma-separated string (`globs: **/*.ts, **/*.tsx`), not the bracketed list v3 wrote.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [ { "command": "npx --no-install ubon hook cursor sessionStart", "timeout": 10 } ],
    "beforeSubmitPrompt": [ { "command": "npx --no-install ubon hook cursor beforeSubmitPrompt", "timeout": 5 } ],
    "beforeShellExecution": [ { "command": "npx --no-install ubon hook cursor beforeShellExecution", "timeout": 10 } ],
    "beforeReadFile": [ { "command": "npx --no-install ubon hook cursor beforeReadFile", "timeout": 5 } ],
    "preToolUse": [ { "matcher": "Write", "command": "npx --no-install ubon hook cursor preToolUse", "timeout": 10 } ],
    "postToolUse": [ { "matcher": "Write", "command": "npx --no-install ubon hook cursor postToolUse", "timeout": 30 } ],
    "stop": [ { "command": "npx --no-install ubon hook cursor stop", "timeout": 120, "loop_limit": 3 } ]
  }
}
```

### 5.2 Specifics

- Output is flat snake_case: `permission`, `user_message`, `agent_message`, `additional_context`, `continue`, `followup_message`.
- `afterFileEdit`, `afterShellExecution`, and `afterMCPExecution` cannot return anything to the agent; after-edit feedback goes through `postToolUse` with the `Write` matcher. (v3 used `afterFileEdit`, so its main feedback never reached the agent.)
- `beforeSubmitPrompt` honors only `continue` and `user_message`. (v3 returned `permission`, so the prompt check never blocked.)
- `permission: "ask"` behaved like a silent deny in Cursor 3.9.16, and on a deny the model saw `user_message`, not `agent_message`. Until a recorded session shows otherwise, the adapter maps `ask` to `deny` and puts the full explanation, including how the user can allow the command, in both messages.
- `stop` receives `status` and `loop_count`. Ubon only checks when `status` is `completed`, and returns `followup_message` with the findings, which Cursor submits as the next user message.
- A Cursor plugin (`.cursor-plugin/plugin.json`) and the Cursor marketplace are a 4.1 item.

## 6. Gemini CLI

`ubon init --gemini` writes hooks into `.gemini/settings.json` (merged), the skill into `.agents/skills/ubon/`, and adds `AGENTS.md` to `context.fileName` so Gemini reads the Ubon block. A Gemini extension (`gemini-extension.json` with `hooks/hooks.json` and `skills/`) is the plugin-style alternative, installable with `gemini extensions install https://github.com/luisfer/ubon`.

| Gemini event | Matcher | Ubon use |
| --- | --- | --- |
| `SessionStart` | none | record the base |
| `BeforeAgent` | none | prompt check |
| `BeforeTool` | `run_shell_command`, `read_file`, `write_file`, `replace` | command, read, and pre-write checks; `decision: deny` with `reason` |
| `AfterTool` | `write_file`, `replace`, `run_shell_command` | file rules; `hookSpecificOutput.additionalContext` or `decision: deny` |
| `AfterAgent` | none | stop gate; `decision: deny` with `reason` makes Gemini continue |

Timeouts in Gemini's config are in milliseconds, unlike every other agent. Project hooks are fingerprinted by Gemini and must be re-trusted after a change.

## 7. GitHub Copilot

Copilot has three hosts with slightly different rules: the CLI, the cloud agent, and the VS Code agent.

`ubon init --copilot` writes:

- `.github/hooks/ubon.json` in Copilot's native format (camelCase events, `version: 1`). The cloud agent reads only this location.
- `.github/workflows/copilot-setup-steps.yml` (or a step added to an existing one) that runs `npm ci`, so the cloud agent has Ubon installed.
- `.github/instructions/ubon.instructions.md` with `applyTo` globs, or the `AGENTS.md` block (Copilot reads both).
- The skill in `.github/skills/ubon/` (Copilot code review also reads skills from there) or `.agents/skills/ubon/`.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [ { "type": "command", "bash": "npx --no-install ubon hook copilot sessionStart", "powershell": "npx --no-install ubon hook copilot sessionStart", "timeoutSec": 10 } ],
    "preToolUse": [ { "type": "command", "bash": "npx --no-install ubon hook copilot preToolUse", "powershell": "npx --no-install ubon hook copilot preToolUse", "matcher": "bash|powershell|view|create|edit", "timeoutSec": 10 } ],
    "postToolUse": [ { "type": "command", "bash": "npx --no-install ubon hook copilot postToolUse", "powershell": "npx --no-install ubon hook copilot postToolUse", "matcher": "create|edit|bash|powershell", "timeoutSec": 30 } ],
    "agentStop": [ { "type": "command", "bash": "npx --no-install ubon hook copilot agentStop", "powershell": "npx --no-install ubon hook copilot agentStop", "timeoutSec": 120 } ]
  }
}
```

Specifics:

- `preToolUse` command hooks fail closed on crashes and non-zero exits (timeouts fail open), which is why design rule 4 requires exit 0 with an explicit decision.
- The cloud agent is non-interactive and treats `ask` as deny.
- Copilot CLI also reads `.claude/settings.json`; if both files register Ubon, events arrive twice, and the idempotency rule handles it.
- For Copilot CLI and VS Code, `additionalContext` is emitted both top-level and inside `hookSpecificOutput`. VS Code's Stop uses a nested `hookSpecificOutput.decision`.
- Copilot code review only calls MCP tools annotated `readOnlyHint: true`; all Ubon tools are.

## 8. Other agents

| Agent | 4.0 support | Later |
| --- | --- | --- |
| Devin Desktop (formerly Windsurf) | `AGENTS.md` block, skill in `.devin/skills/`, MCP | Hooks in `.devin/hooks.json` use exit code 2 and stderr only; an adapter can support `pre_run_command` and `pre_write_code`. |
| Kiro | skill in `.kiro/skills/`, steering file, MCP | Hooks (`.kiro/hooks/*.json`, `version: "v1"`) through an adapter. |
| OpenCode | skill (reads `.agents/skills/`), `AGENTS.md`, MCP | A small plugin file in `.opencode/plugins/` that calls `ubon hook opencode`. |
| Amp | skill, `AGENTS.md`, MCP | A TypeScript plugin in `.amp/plugins/`. |
| Cline | `.clinerules/` entry, skill, MCP | Executable hooks in `.clinerules/hooks/`. |
| Factory Droid, Goose | skill, `AGENTS.md`, MCP | Both accept Claude-shaped hooks; likely a small adapter. |
| Zed, JetBrains Junie | `AGENTS.md`, skill, MCP | Junie hooks later if requested. |
| Aider | `CONVENTIONS.md` note | `--lint-cmd "ubon check"` with `--auto-lint` (documented recipe). |

New adapters are accepted from contributors when they come with recorded sessions for the agent (section 12).

## 9. Git hooks

- `pre-commit`: `ubon check --staged`, which reads staged blobs from the index, so what is checked is what gets committed (v3 checked the working tree).
- `pre-push`: `ubon check --base @{upstream}`.
- `ubon init --git-hooks` detects husky, lefthook, simple-git-hooks, or the pre-commit framework and adds Ubon to the existing setup. Without any of them, it writes `.githooks/` scripts and asks before setting `core.hooksPath`.
- The Ubon repository ships a `.pre-commit-hooks.yaml`, so pre-commit framework users can add it with a `repo:` entry pinned to a tag.

## 10. CI

### 10.1 GitHub Action

`action.yml` at the repository root; it runs the committed `dist/ubon.mjs` from the tagged release, so there is no install step and no network access unless `online: true`.

```yaml
name: ubon
on: pull_request
permissions:
  contents: read
jobs:
  ubon:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write      # only needed for SARIF upload
    steps:
      - uses: actions/checkout@<sha>   # v7
        with:
          fetch-depth: 0               # needed to find the merge base
      - uses: luisfer/ubon@<sha>       # v4.0.0
        with:
          sarif: true
          summary: true
```

| Input | Default | Meaning |
| --- | --- | --- |
| `base` | the pull request's base branch | ref to diff against |
| `all` | `false` | check every file instead of the diff |
| `sarif` | `false` | write SARIF and upload it with `github/codeql-action/upload-sarif` |
| `summary` | `true` | write the Markdown report to the job summary |
| `comment` | `false` | post or update one pull request comment (needs `pull-requests: write`) |
| `online` | `false` | allow registry and OSV lookups |
| `fail-on` | `block` | `block` or `never` |

Outputs: `blocking`, `warnings`, `report` (path to JSON). The Markdown report always includes a section listing suppressions added in the pull request and findings an agent left unresolved.

### 10.2 Other CI systems

Documented recipes for GitLab CI, CircleCI, and plain `npx ubon@4.0.0 check --base "$BASE" --format sarif --output ubon.sarif`. The docs explain `fetch-depth` or equivalent, since shallow clones have no merge base.

## 11. MCP server

- Transport: stdio. Serves both protocol eras: the 2025-11-25 `initialize` handshake, which Claude Code still uses for stdio servers by default, and the 2026-07-28 stateless revision (`server/discover`). Implementation: the official `@modelcontextprotocol/server` v2 package (dependencies: `zod` and `@modelcontextprotocol/core`, no web frameworks), pinned and bundled into a separate file that only `ubon mcp` loads. Writing the protocol by hand was considered and rejected now that the spec has two live versions.
- Tools, in a fixed order, with static descriptions (never generated from repository content): `check`, `explain`, `map`, `vet`. Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` (`vet` sets `openWorldHint: true`, because it contacts the registry). Each has an `outputSchema` and returns `structuredContent` plus a short text summary.
- Scanned code is hostile data: snippets in results are truncated, control and bidi and Unicode tag characters are stripped, secrets are masked, and results are labelled as data.
- Paths are confined to the workspace the client passes (roots are deprecated in the latest spec); anything outside is rejected.
- Logs go to stderr only.
- Registry: `package.json` carries `"mcpName": "io.github.luisfer/ubon"` and a `server.json` is published to the MCP registry with `mcp-publisher` from the release workflow.

Config snippets in the docs for `.mcp.json` (Claude Code and others), `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, `.gemini/settings.json`, all pinned to an exact Ubon version.

## 12. `ubon init`

- Detects the agents in use from their folders (`.claude/`, `.codex/`, `.cursor/`, `.gemini/`, `.github/hooks/`, `.devin/`, `.kiro/`) and installed CLIs, and proposes targets. Flags select targets explicitly: `--claude`, `--codex`, `--cursor`, `--gemini`, `--copilot`, `--git-hooks`, `--github`, `--all`.
- Dry run by default: prints every file it would create or change as a diff. `--yes` writes.
- JSON files are merged: Ubon's entries are identified by their command (`ubon hook ...`), replaced on update, never duplicated, and nothing else in the file is touched. Unparseable files are left alone with an error.
- Markdown files get a delimited block (`<!-- ubon:begin -->` to `<!-- ubon:end -->`), updated in place.
- Writes `ubon.json` with proposals for `auth.functions` and `auth.public`, marked for human review.
- Recommends adding Ubon as a dev dependency so every hook uses the lockfile-pinned version.
- `ubon init --remove` undoes everything it added.

## 13. One source, many outputs

The skill, playbooks, hook configs, plugin manifests, and instruction blocks are generated from `skills/` and `src/adapters/*/spec.ts` by `scripts/gen-integrations.mjs`:

- Placeholders for the command prefix (`/` in Claude Code, `$` in Codex), the Ubon command, and paths.
- Per-agent frontmatter (spec-only variant for strict validators).
- Output folders: `integrations/claude-code/`, `integrations/codex/`, `integrations/cursor/`, `integrations/gemini/`, `integrations/copilot/`, plus `.agents/skills/ubon/` and `.claude/skills/ubon/` at the repository root so `npx skills add luisfer/ubon` and `gh skill install` work.
- Generated files are committed. CI regenerates them and fails on any difference.
- `docs/compatibility.md` lists, per agent, the versions on which the recorded sessions were captured and the last manual verification date.

## 14. Distribution checklist per release

- npm: `ubon@<version>` through trusted publishing with provenance.
- Claude Code: marketplace entry updated (plugin version bumped).
- Codex, Copilot CLI: plugin manifests updated.
- Agent Skills: `.agents/skills/ubon/` updated for `npx skills` and `gh skill`.
- Gemini: extension version bumped.
- GitHub Action: tag `v4.x.y` and moving major tag `v4`; README examples use the commit SHA.
- MCP registry: `server.json` version bumped.
- pre-commit framework: tag.
