import { maskValue } from '../../core/mask.ts';
import { shannonEntropy } from '../../data/secrets.ts';
import type { PathKey } from '../../lang/structured.ts';
import { findProviderKeys } from '../secret/provider-key.ts';
import { isCredentialShapedName, isPlaceholderValue } from '../secret/names.ts';
import type { Rule } from '../types.ts';
import { type ConfigDoc, type ConfigKind, type KeyValue, at, configKind, hookSection, mcpServers, parseConfig } from './config-files.ts';

/**
 * Literal credentials in agent and MCP configuration: env blocks, HTTP
 * headers, bearer tokens, server arguments, and URLs. Values in a known
 * provider format are left to secret/provider-key, which reports them in every
 * file, so the two rules never report the same value.
 */

const KINDS: ReadonlySet<ConfigKind> = new Set([
  'claude-settings',
  'codex-config',
  'codex-hooks',
  'cursor-hooks',
  'gemini-settings',
  'gemini-extension',
  'copilot-hooks',
  'copilot-settings',
  'plugin-hooks',
  'mcp',
  'vscode-mcp',
  'zed-settings',
  'opencode',
]);

/** `${VAR}`, `$VAR`, `${env:VAR}`, `${input:id}`, `{env:VAR}`, `env:VAR`, `%VAR%`, `{{secret}}`. */
export function isIndirection(value: string): boolean {
  const v = value.trim();
  if (/\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|\{env:[^}]+\}|\{\{[^}]+\}\}|%[A-Za-z_][A-Za-z0-9_]*%|\$\(/.test(v)) return true;
  if (/^env:[A-Za-z_][A-Za-z0-9_]*$/i.test(v)) return true;
  if (/^(op|vault|secret|keychain|aws-sm|gcp-sm):\/\//i.test(v)) return true;
  return false;
}

const DB_URL = /^(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|cockroachdb|clickhouse)(?:\+[a-z0-9]+)?:\/\/[^\s:/@]*:[^\s@]+@/i;

/** A value that looks like a random credential rather than a word, path, URL, or setting. */
export function looksLikeSecretValue(value: string): boolean {
  const v = value.trim();
  if (v.length < 16 || v.length > 1000) return false;
  if (/\s/.test(v)) return false;
  if (isPlaceholderValue(v) || isIndirection(v)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return false;
  if (/^[~./\\]|^[A-Za-z]:[\\/]/.test(v) || /\.(json|pem|key|p12|txt|env|ya?ml|toml|crt|cer)$/i.test(v)) return false;
  if (/^\d+$/.test(v) || /^(true|false|null)$/i.test(v)) return false;
  // Settings written as words: gpt-4o-mini-2024-07-18, oauth2-device-flow, us-east-1 (UUIDs stay candidates).
  if (/^[a-z0-9]+([-_.][a-z0-9]+)+$/.test(v) && v.split(/[-_.]/).filter((s) => /^[a-z]{3,}$/.test(s)).length >= 2) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(v)).length;
  if (classes < 2) return false;
  return shannonEntropy(v) >= 3.4;
}

function hasProviderKey(value: string): boolean {
  return findProviderKeys(value).length > 0;
}

interface Candidate {
  /** Where the value sits, for messages: "env value SLACK_TOKEN", "header Authorization". */
  where: string;
  name: string;
  value: string;
  path: PathKey[];
}

function envCandidates(entries: readonly KeyValue[], where: string): Candidate[] {
  return entries.filter((e) => isCredentialShapedName(e.key)).map((e) => ({ where: `${where} ${e.key}`, name: e.key, value: e.value, path: e.path }));
}

const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key|apikey|x-auth-token|x-access-token|private-token|x-goog-api-key|x-subscription-token|ocp-apim-subscription-key|cookie)$/i;

function headerCandidates(entries: readonly KeyValue[]): Candidate[] {
  const out: Candidate[] = [];
  for (const e of entries) {
    if (!CREDENTIAL_HEADER.test(e.key) && !isCredentialShapedName(e.key)) continue;
    const value = e.value.replace(/^(Bearer|Basic|Token|token|Bot|ApiKey)\s+/, '');
    out.push({ where: `header ${e.key}`, name: e.key, value, path: e.path });
  }
  return out;
}

/** `--token VALUE`, `--api-key=VALUE`, `API_KEY=VALUE` in server arguments. */
function argCandidates(args: readonly string[], argPaths: readonly PathKey[][]): Candidate[] {
  const out: Candidate[] = [];
  args.forEach((arg, i) => {
    const path = argPaths[i] ?? [];
    const eq = /^(--?[\w-]+|[A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
    if (eq && isCredentialShapedName((eq[1] as string).replace(/^-+/, ''))) {
      out.push({ where: `argument ${(eq[1] as string)}`, name: eq[1] as string, value: eq[2] as string, path });
      return;
    }
    const prev = args[i - 1];
    if (prev && /^--?[\w-]+$/.test(prev) && isCredentialShapedName(prev.replace(/^-+/, ''))) out.push({ where: `argument ${prev}`, name: prev, value: arg, path });
  });
  return out;
}

/** `https://host/sse?api_key=VALUE` and `https://user:VALUE@host`. */
function urlCandidates(url: string, path: PathKey[]): Candidate[] {
  const out: Candidate[] = [];
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  for (const part of query.split('&')) {
    const [k, v] = part.split('=');
    if (k && v && isCredentialShapedName(decodeURIComponent(k))) out.push({ where: `URL parameter ${k}`, name: k, value: decodeURIComponent(v), path });
  }
  const userinfo = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s:]*:([^/@\s]+)@/i.exec(url);
  if (userinfo && !DB_URL.test(url)) out.push({ where: 'URL password', name: 'password', value: userinfo[1] as string, path });
  return out;
}

function candidates(doc: ConfigDoc, projectFiles: readonly string[]): Array<Candidate & { server?: string }> {
  const out: Array<Candidate & { server?: string }> = [];
  for (const s of mcpServers(doc)) {
    const tag = (c: Candidate) => ({ ...c, server: s.name });
    out.push(...envCandidates(s.env, 'env value').map(tag));
    out.push(...headerCandidates(s.headers).map(tag));
    out.push(...s.secrets.map((k) => tag({ where: k.key, name: k.key, value: k.value, path: k.path })));
    out.push(...argCandidates(s.args, s.argPaths).map(tag));
    if (s.url && s.urlPath) out.push(...urlCandidates(s.url, s.urlPath).map(tag));
  }
  // Claude Code settings: "env": { ... }; Codex: shell_environment_policy.set
  const topEnv: Array<[PathKey[], string]> = [
    [['env'], 'env value'],
    [['shell_environment_policy', 'set'], 'shell environment value'],
  ];
  for (const [path, where] of topEnv) {
    const obj = at(doc.data, path);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const entries: KeyValue[] = Object.entries(obj as Record<string, unknown>)
        .filter((e): e is [string, string] => typeof e[1] === 'string')
        .map(([key, value]) => ({ key, value, path: [...path, key] }));
      out.push(...envCandidates(entries, where));
    }
  }
  for (const h of hookSection(doc, projectFiles)?.handlers ?? []) out.push(...envCandidates(h.env, `${h.event} hook env value`));
  return out;
}

export const secretInConfig: Rule = {
  meta: {
    id: 'agent/secret-in-config',
    level: 'block',
    scope: 'file',
    title: 'Credential in agent or MCP config',
    summary: 'A literal token in an agent or MCP config file (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.claude/settings*.json`, `.codex/config.toml`, `.gemini/settings.json`, and similar): env values, headers, bearer tokens, server arguments, and URL parameters with credential names.',
    why: 'These files are committed and shared, and agents read them, so a token in them reaches everyone with access to the repository and every model that loads the config. Config files support env references so the value can stay out of the file.',
    fix: 'Replace the value with an env reference such as "${API_KEY}", keep the value in your shell or an ignored .env file, and rotate the exposed token.',
    cwe: ['CWE-798'],
    owasp: ['A07:2025', 'ASI04'],
    levels: 'Values in a known provider format (sk-..., ghp_..., xoxb-...) are reported by secret/provider-key instead. Test and example folders report at warn.',
  },
  appliesTo: (file) => !file.generated && KINDS.has(configKind(file.path) as ConfigKind),
  text(ctx) {
    const doc = parseConfig(ctx.file.path, ctx.text);
    if (!doc?.data) return;
    const lowStakes = ctx.file.contexts.has('test') || ctx.file.contexts.has('example');
    const seen = new Set<string>();
    for (const c of candidates(doc, ctx.project.files)) {
      const value = c.value.trim();
      if (isIndirection(value) || hasProviderKey(value) || DB_URL.test(value)) continue;
      if (!looksLikeSecretValue(value)) continue;
      const line = doc.valueLineOf(c.path) ?? doc.lineOf(c.path) ?? 1;
      const key = `${line}:${c.where}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const masked = maskValue(value);
      const server = c.server ? ` of MCP server "${c.server}"` : '';
      ctx.report({
        line,
        level: lowStakes ? 'warn' : 'block',
        message: `The ${c.where}${server} is a literal credential (${masked}).`,
        evidence: `${c.name}: ${masked}`,
        key: c.where,
        fix: `Replace it with an env reference such as "\${${envNameFor(c.name)}}", keep the value outside the repository, and rotate it.`,
      });
    }
  },
};

function envNameFor(name: string): string {
  const upper = name
    .replace(/^-+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
  if (/^AUTHORIZATION$|^PASSWORD$|^BEARER_TOKEN$/.test(upper)) return 'API_TOKEN';
  return upper || 'API_KEY';
}
