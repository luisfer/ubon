import { Rule, RuleMeta } from '../types';

const make = (meta: RuleMeta, fileTypes?: string[]): Rule => ({
  meta,
  impl: {
    fileTypes: fileTypes || ['json', 'md', 'sh', 'mdc', 'yml', 'yaml']
  }
});

/**
 * Claude Code / agent-tooling pack — detects secrets and dangerous patterns
 * committed in `.claude/`, `.cursor/`, `.windsurf/`, `.aider*`, `CLAUDE.md`,
 * `.cursorrules`, `.windsurfrules` and MCP configs. Many AI workflows
 * accidentally commit OAuth tokens, API keys, or `rm -rf "$VAR"` shell hooks
 * into these dotfiles.
 */
export const agentRules: Record<string, Rule> = {
  CC001: make({
    id: 'CC001',
    category: 'security',
    severity: 'high',
    message: 'Secret literal inside `.claude/settings*.json`',
    fix: 'Move the value into `$HOME/.claude/settings.local.json` (outside the repo) or a secret manager. Rotate if it was committed.',
    impact:
      'Claude Code settings committed to the repo are world-readable. API keys in them are instantly exposed on any clone.',
    helpUri: 'https://docs.claude.com/en/docs/claude-code/settings'
  }),
  CC002: make({
    id: 'CC002',
    category: 'security',
    severity: 'high',
    message: 'Claude Code hook shell script uses unquoted variable in a destructive command (`rm`/`mv`/`cp`/`eval`)',
    fix: 'Quote every expansion: `rm -rf "$VAR"`, not `rm -rf $VAR`. Prefer `--` guards to stop flag injection.',
    impact:
      'An unquoted `$VAR` that happens to be empty or contain `/` can wipe the whole working tree when the hook fires.',
    helpUri: 'https://www.shellcheck.net/wiki/SC2086'
  }),
  CC003: make({
    id: 'CC003',
    category: 'security',
    severity: 'high',
    message: 'Claude Code hook executes `curl | sh` or pipes remote content to a shell',
    fix: 'Download to a temp file, verify a checksum, then execute. Never trust network output to run as-is.',
    impact:
      'A compromised or typosquatted URL turns a hook into remote code execution on every tool use.',
    helpUri: 'https://docs.claude.com/en/docs/claude-code/hooks'
  }),
  CC004: make({
    id: 'CC004',
    category: 'security',
    severity: 'high',
    message: 'Secret-shaped string inside `CLAUDE.md` / `.claude/agents/*.md`',
    fix: 'Remove the literal from the markdown. If it was ever committed, rotate the credential.',
    impact:
      'Agent prompt files are part of the prompt itself and ship alongside the repo. A secret in here is as exposed as one in `config.js`.',
    helpUri: 'https://docs.claude.com/en/docs/claude-code/memory'
  }),
  CC005: make({
    id: 'CC005',
    category: 'security',
    severity: 'high',
    message: 'MCP server config exposes a secret in its `env` block',
    fix: 'Read the value from the user\'s shell env at launch (`${VAR}` resolution) rather than committing the literal.',
    impact:
      '.mcp.json / `.cursor/mcp.json` / `.windsurf/mcp.json` / `cline_mcp_settings.json` are typically committed. A literal key in `env` leaks on every clone.',
    helpUri: 'https://modelcontextprotocol.io/docs/concepts/configuration'
  }),
  CC006: make({
    id: 'CC006',
    category: 'security',
    severity: 'high',
    message: 'Secret-shaped string inside `.cursorrules` / `.cursor/rules/*.mdc` / `.windsurfrules` / `.aiderconfig`',
    fix: 'Remove the secret from the rules file. These are committed as part of the project prompt.',
    impact:
      'Cursor / Windsurf / Aider rule files are part of the agent prompt and shipped with the repo — a secret here is already disclosed.'
  }),
  CC007: make({
    id: 'CC007',
    category: 'security',
    severity: 'low',
    message: 'Claude Code session transcripts or TODO state committed to the repo',
    fix: 'Add `.claude/todos/` and `.claude/history/` to `.gitignore`.',
    impact:
      'Transcripts routinely contain pasted secrets, internal URLs, or customer data. Committing them leaks that context.',
    helpUri: 'https://docs.claude.com/en/docs/claude-code/overview'
  }),
  CC008: make({
    id: 'CC008',
    category: 'security',
    severity: 'medium',
    message: 'Prompt-injection marker inside agent rules / memory file',
    fix: 'Remove lines that try to override the agent\'s behavior (`IGNORE ALL PREVIOUS INSTRUCTIONS`, `disregard the system prompt`, etc.).',
    impact:
      'Agent memory files are concatenated into the prompt. An injection line there redirects the model on every run.',
    helpUri: 'https://simonwillison.net/2023/May/2/prompt-injection-explained/'
  })
};
