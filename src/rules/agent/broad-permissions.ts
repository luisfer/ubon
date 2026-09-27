import { isRecord } from '../../lang/structured.ts';
import type { Rule } from '../types.ts';
import { at, configKind, mcpServers, parseConfig } from './config-files.ts';

/**
 * Committed project settings that let an agent act without asking: Claude
 * Code bypass mode and unscoped Bash rules, Codex full access without
 * approvals, Gemini CLI unscoped shell approval and trusted MCP servers,
 * Cursor CLI unscoped shell rules. Personal files (settings.local.json) are
 * not shared, so they are left alone.
 */

export const broadPermissions: Rule = {
  meta: {
    id: 'agent/broad-permissions',
    level: 'warn',
    scope: 'file',
    title: 'Agent settings that skip approvals',
    summary: 'Committed agent settings that grant broad autonomy: Claude Code `defaultMode: "bypassPermissions"`, unscoped `Bash` or `Bash(*)` rules, `enableAllProjectMcpServers: true`; Codex `danger-full-access` with `approval_policy = "never"`; Gemini CLI unscoped `run_shell_command` in `tools.allowed` and `trust: true` MCP servers; Cursor CLI `Shell(*)`.',
    why: 'Shared settings apply to everyone who opens the project, and a pull request can change them. With approvals off, a prompt injection in a file, issue, or web page can run any command the agent can.',
    fix: 'Allow specific commands (for example Bash(npm test)) in shared settings and keep broader permissions in your personal settings file.',
    cwe: ['CWE-250'],
    owasp: ['ASI02', 'ASI03'],
  },
  appliesTo: (file) => {
    if (file.generated || file.contexts.has('test') || file.contexts.has('example')) return false;
    if (/settings\.local\.json$/.test(file.path)) return false;
    const kind = configKind(file.path);
    return kind === 'claude-settings' || kind === 'codex-config' || kind === 'gemini-settings' || kind === 'cursor-cli';
  },
  text(ctx) {
    const doc = parseConfig(ctx.file.path, ctx.text);
    if (!doc || !isRecord(doc.data)) return;
    const line = (path: Array<string | number>) => doc.lineOf(path) ?? 1;
    const report = (path: Array<string | number>, message: string, key: string) => ctx.report({ line: line(path), message, key });
    if (doc.kind === 'claude-settings') {
      if (at(doc.data, ['permissions', 'defaultMode']) === 'bypassPermissions') {
        report(['permissions', 'defaultMode'], 'defaultMode "bypassPermissions" in shared settings turns off permission prompts for everyone who opens the project (recent Claude Code versions ignore it in project settings; other tools may not).', 'bypass');
      }
      const allow = at(doc.data, ['permissions', 'allow']);
      if (Array.isArray(allow)) {
        allow.forEach((entry, i) => {
          if (typeof entry !== 'string') return;
          if (/^(Bash|PowerShell)(\(\s*(\*|:\*|\*\*)?\s*\))?$/.test(entry.trim())) report(['permissions', 'allow', i], `The allow rule "${entry}" lets the agent run any shell command without asking.`, `allow:${entry}`);
        });
      }
      if (at(doc.data, ['enableAllProjectMcpServers']) === true) {
        report(['enableAllProjectMcpServers'], 'enableAllProjectMcpServers: true approves every MCP server in .mcp.json, including servers a later change adds.', 'mcp');
      }
      return;
    }
    if (doc.kind === 'codex-config') {
      const scopes: Array<Array<string | number>> = [[]];
      const profiles = at(doc.data, ['profiles']);
      if (isRecord(profiles)) for (const name of Object.keys(profiles)) scopes.push(['profiles', name]);
      for (const scope of scopes) {
        if (at(doc.data, [...scope, 'sandbox_mode']) === 'danger-full-access' && at(doc.data, [...scope, 'approval_policy']) === 'never') {
          const where = scope.length === 0 ? '' : ` in profile "${scope[1]}"`;
          report([...scope, 'sandbox_mode'], `sandbox_mode "danger-full-access" with approval_policy "never"${where} lets Codex run any command with full access and never ask.`, `codex:${scope.join('.')}`);
        }
      }
      return;
    }
    if (doc.kind === 'gemini-settings') {
      const allowed = at(doc.data, ['tools', 'allowed']);
      if (Array.isArray(allowed)) {
        allowed.forEach((entry, i) => {
          if (typeof entry !== 'string') return;
          if (/^(run_shell_command|ShellTool)(\(\s*\*?\s*\))?$/.test(entry.trim())) report(['tools', 'allowed', i], `tools.allowed "${entry}" lets Gemini CLI run any shell command without asking.`, `allowed:${entry}`);
        });
      }
      for (const s of mcpServers(doc)) {
        if (at(doc.data, [...s.path, 'trust']) === true) report([...s.path, 'trust'], `MCP server "${s.name}" has trust: true, which skips confirmation for every tool it provides.`, `trust:${s.name}`);
      }
      return;
    }
    if (doc.kind === 'cursor-cli') {
      const allow = at(doc.data, ['permissions', 'allow']);
      if (!Array.isArray(allow)) return;
      allow.forEach((entry, i) => {
        if (typeof entry === 'string' && /^Shell(\(\s*\*{1,2}\s*\))?$/.test(entry.trim())) report(['permissions', 'allow', i], `The allow rule "${entry}" lets Cursor run any shell command without asking.`, `cursor:${entry}`);
      });
    }
  },
};
