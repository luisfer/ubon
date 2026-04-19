import { Rule } from '../types';

/**
 * AI005: Secrets inside MCP server configuration.
 *
 * Cursor, Claude Desktop, Windsurf and other MCP clients load their server
 * list from JSON files (`.cursor/mcp.json`, `mcp.json`, `claude_desktop_config.json`,
 * etc.). It is common for vibe-coders to commit these files with API keys,
 * PATs or DB URLs baked into the `env` block.
 *
 * Detection lives in AIScanner because we need to parse the JSON shape.
 */
const rule: Rule = {
  meta: {
    id: 'AI005',
    category: 'security',
    severity: 'high',
    message: 'MCP server configuration contains hardcoded secret',
    fix: 'Reference an env var (e.g. `${env:GITHUB_TOKEN}` or `process.env.X`) instead of committing the literal value, and add the config file to .gitignore.',
    impact:
      'MCP server configs are routinely shared in repos and Linear tickets; embedded tokens grant broad scopes (GitHub PATs, DB URLs, Slack bot tokens).',
    helpUri: 'https://modelcontextprotocol.io/docs/concepts/configuration'
  },
  impl: {
    fileTypes: ['json']
  }
};

export default rule;
