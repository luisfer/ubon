# Ubon over MCP

`ubon mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes the scanner to AI assistants (Cursor, Claude Desktop, Windsurf,
Cline, OpenAI Apps SDK). The assistant can call tools to scan a project,
explain a rule, preview fixes, and apply them — all without spawning a shell.

## Install

`@modelcontextprotocol/sdk` is declared as an `optionalDependency` of
`ubon`, so most installers will pick it up automatically. If your install
flags (`--no-optional`, restricted registries, monorepo workspace tweaks)
skipped it, add it explicitly:

```bash
npm install -g ubon
# add the SDK only if it was skipped:
npm install -g @modelcontextprotocol/sdk

# project-local equivalent
npm install --save-dev ubon
npm install --save-dev @modelcontextprotocol/sdk
```

`ubon mcp` prints a one-line install hint and exits non-zero if the SDK is
missing, so you'll know quickly. `ubon doctor` also reports the SDK
status under "optional dependencies".

## Tools

| Tool                  | Description                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `ubon.scan`           | Full scan; returns the v2.0.0 JSON report                                          |
| `ubon.check`          | Cheap loop (`fast: true`); same JSON shape                                         |
| `ubon.explain`        | Returns rule metadata (`severity`, `fix`, `impact`, `helpUri`)                     |
| `ubon.preview-fixes`  | Returns file-level diffs for auto-fixable findings (no disk write)                 |
| `ubon.apply-fixes`    | Writes the auto-fixes. **Defaults to dry-run**; pass `apply: true` to confirm.     |

All tools accept `directory` (defaults to the assistant's CWD) and most accept
`profile` (`auto`, `lovable`, `next`, `react`, `sveltekit`, `astro`,
`remix`, `hono`). The `python`, `rails`, and `vue` profiles were removed
in v3.0.0 — see [`MIGRATION-v3.md`](../MIGRATION-v3.md).

## Cursor configuration

Add to `~/.cursor/mcp.json` (or `${workspaceFolder}/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ubon": {
      "command": "npx",
      "args": ["-y", "ubon", "mcp"]
    }
  }
}
```

## Claude Desktop configuration

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ubon": {
      "command": "npx",
      "args": ["-y", "ubon", "mcp"]
    }
  }
}
```

## Output schema

All scan tools return JSON that conforms to
[`docs/schema/ubon-finding.schema.json`](./schema/ubon-finding.schema.json).
The schema is published with the npm package, so MCP clients can fetch it
locally for validation.

## Safety

- `ubon.apply-fixes` is the only tool with side effects. It is dry-run by
  default; the assistant must explicitly send `apply: true`.
- `ubon mcp` honours the same `--allow-config-js` and
  `UBON_ALLOW_REMOTE_CRAWL` gates as the CLI.
- Scans never upload anything off-machine. Everything runs locally.
