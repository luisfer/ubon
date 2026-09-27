# agent-config

No application code, only the files that configure coding agents. These files steer what an agent does, so a problem in them affects every session.

| Problem | File |
| --- | --- |
| An instruction hidden in Unicode tag characters, invisible in editors and on GitHub | `AGENTS.md` |
| `curl ... \| sh` in a skill script | `.claude/skills/deploy/scripts/setup.sh` |
| A literal GitHub token in the MCP config | `.mcp.json` |
| An MCP server run with `npx -y` and no version | `.mcp.json` |
| `bypassPermissions` in committed settings | `.claude/settings.json` |
| A misspelled hook event (`PreToolUSe`), so the hook never runs | `.claude/settings.json` |
| A task that runs when the folder is opened | `.vscode/tasks.json` |
| An issue title expanded inside a `run` step, in a workflow that runs an agent on new issues | `.github/workflows/triage.yml` |

`fixed/` removes the hidden text, pins the install script and checks its checksum, reads the token from the environment, pins the MCP server, uses `acceptEdits`, fixes the event name, removes `runOn: folderOpen`, and passes the issue title through an environment variable. `EXPECTED.json` lists every finding with its rule and line.
