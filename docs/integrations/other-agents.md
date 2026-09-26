# Other agents

Agents without an Ubon adapter still get the skill, the `AGENTS.md` block, and the MCP server.

| Agent | What works today |
| --- | --- |
| Devin Desktop (formerly Windsurf) | `AGENTS.md` block, skill in `.devin/skills/`, MCP |
| Kiro | skill in `.kiro/skills/`, MCP |
| OpenCode | skill (reads `.agents/skills/`), `AGENTS.md`, MCP |
| Amp | skill, `AGENTS.md`, MCP |
| Cline | skill, MCP |
| Factory Droid, Goose | skill, `AGENTS.md`, MCP |
| Zed, JetBrains Junie | `AGENTS.md`, skill, MCP |
| Aider | `--lint-cmd "npx ubon check"` with `--auto-lint` |

To install the skill for any agent that reads `.agents/skills/`: `npx skills add luisfer/ubon`.

New adapters are welcome as contributions. Each one needs recorded hook payloads from the real agent and tests that replay them; see [AGENTS.md](../../AGENTS.md).
