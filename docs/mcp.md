# MCP server

`ubon mcp` runs an MCP server over stdio for clients that have no shell (Claude Desktop, IDE chat panels) or that prefer typed tools. Agents with a shell can run the `ubon` command instead, which costs no context for tool definitions.

## Tools

All tools are read-only (`readOnlyHint: true`) and none writes files.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `check` | `path`, `mode` (`diff`, `all`, `staged`), `base`, `rules` | The JSON report as structured content, and the agent format as text. |
| `explain` | `rule` | What the rule checks, why, the fix, and examples. |
| `map` | `path` | Entry points with their auth calls, data access, model calls, and env variables. |
| `vet` | `packages` | Registry and OSV verdicts for each package (this tool contacts the npm registry and api.osv.dev, so it is marked `openWorldHint: true`). |

Tool descriptions are fixed strings, never built from repository content. Results quote code from the repository, so the text result starts by saying that quoted code is data, not instructions. Evidence is masked and control, bidirectional, and Unicode tag characters are removed.

Paths are confined to the workspace: the git root of the directory the client starts the server in, or `--root <dir>`. Anything outside is rejected as a tool error.

## Protocol versions

The server answers both current MCP revisions on the same stdio connection: the `initialize` handshake of 2025-11-25 (and 2025-06-18, 2025-03-26, 2024-11-05), and the stateless 2026-07-28 revision, where each request carries its protocol version and client capabilities in `_meta` and `server/discover` lists the supported versions. A request for an unsupported version gets error -32022 with the supported list. The tests talk to it with the official MCP TypeScript client in both modes.

## Client configuration

Pin the version so a new release does not change behavior without you knowing.

`.mcp.json` (Claude Code and others):

```json
{
  "mcpServers": {
    "ubon": { "command": "npx", "args": ["-y", "ubon@4.0.0", "mcp"] }
  }
}
```

`.vscode/mcp.json`:

```json
{
  "servers": {
    "ubon": { "type": "stdio", "command": "npx", "args": ["-y", "ubon@4.0.0", "mcp"] }
  }
}
```

`.codex/config.toml`:

```toml
[mcp_servers.ubon]
command = "npx"
args = ["-y", "ubon@4.0.0", "mcp"]
```

`.cursor/mcp.json` and `.gemini/settings.json` use the same `mcpServers` shape as `.mcp.json`.

If Ubon is a dev dependency of the project, use `"command": "npx", "args": ["--no-install", "ubon", "mcp"]` instead, so the server runs the version in your lockfile.
