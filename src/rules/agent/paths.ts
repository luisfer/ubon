import { closeSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, posix, resolve, win32 } from 'node:path';
import { matchesAny } from '../../core/glob.ts';
import { isEnvFileName } from '../secret/names.ts';
import type { ActionVerdict, CommandContext } from './command-types.ts';

/**
 * Path checks for the hook runtime: reads of files that hold secrets
 * (secret/read-sensitive-file) and writes to files that configure the checks
 * themselves (agent/protected-path-write). Paths may be absolute, relative to
 * the command's directory, or start with `~`.
 */

export type PathCheckContext = Pick<CommandContext, 'cwd' | 'root' | 'config'> & {
  /** Home directory; defaults to the current user's. */
  home?: string;
};

interface ResolvedPath {
  /** Absolute, with forward slashes. */
  abs: string;
  /** Relative to the project root, or null when outside it. */
  rel: string | null;
  /** Relative to the home directory, or null when outside it. */
  homeRel: string | null;
  base: string;
  /** The path as written, for messages. */
  shown: string;
}

function toSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

export function resolveUserPath(input: string, ctx: PathCheckContext): ResolvedPath {
  const home = toSlash(ctx.home ?? homedir());
  let p = toSlash(input.trim());
  if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
  else if (/^\$\{?HOME\}?(\/|$)/.test(p)) p = home + p.replace(/^\$\{?HOME\}?/, '');
  else if (/^\$env:USERPROFILE/i.test(p) || /^%USERPROFILE%/i.test(p)) p = home + p.replace(/^(\$env:USERPROFILE|%USERPROFILE%)/i, '');
  const windows = /^[A-Za-z]:\//.test(p);
  let abs: string;
  if (windows) abs = toSlash(win32.normalize(p));
  else if (isAbsolute(p) || p.startsWith('/')) abs = posix.normalize(p);
  else abs = toSlash(resolve(toSlash(ctx.cwd), p));
  const root = toSlash(ctx.root).replace(/\/+$/, '');
  const rel = abs === root ? '' : abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : null;
  const homeRel = abs === home ? '' : abs.startsWith(`${home}/`) ? abs.slice(home.length + 1) : null;
  const base = abs.slice(abs.lastIndexOf('/') + 1);
  return { abs, rel, homeRel, base, shown: input.trim() };
}

// ---------------------------------------------------------------------------
// Sensitive files

const PRIVATE_KEY_NAME = /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/;
const KEY_EXT = /\.(key|p12|pfx|p8|ppk|jks|keystore)$/i;
const PEM_EXT = /\.(pem|crt|cer)$/i;

/** Files in the home directory that hold credentials, relative to it. */
const HOME_SECRETS: Array<[RegExp, string]> = [
  [/^\.ssh\/?$/, 'SSH keys'],
  [/^\.(aws|gnupg|kube|docker|password-store)\/?$|^\.config\/(gcloud|gh)\/?$/, 'stored credentials'],
  [/^\.ssh\/(?!known_hosts(\.old)?$|authorized_keys2?$|.*\.pub$)[^/]+$/, 'an SSH key or SSH config'],
  [/^\.aws\/(credentials|sso\/cache\/.*|cli\/cache\/.*)$/, 'AWS credentials'],
  [/^\.npmrc$/, 'npm credentials'],
  [/^\.yarnrc(\.yml)?$/, 'package registry credentials'],
  [/^\.pypirc$/, 'PyPI credentials'],
  [/^_?\.?netrc$/, 'login passwords'],
  [/^\.git-credentials$/, 'git credentials'],
  [/^\.docker\/config\.json$/, 'container registry credentials'],
  [/^\.kube\/config$/, 'Kubernetes credentials'],
  [/^\.config\/gh\/hosts\.ya?ml$/, 'a GitHub CLI token'],
  [/^\.config\/hub$/, 'a GitHub token'],
  [/^\.config\/gcloud\/(application_default_credentials\.json|credentials\.db|access_tokens\.db|legacy_credentials\/.*)$/, 'Google Cloud credentials'],
  [/^\.azure\/(accessTokens\.json|msal_token_cache\..*|service_principal_entries\.json)$/, 'Azure credentials'],
  [/^\.gnupg\/(private-keys-v1\.d\/.*|secring\.gpg)$/, 'GPG private keys'],
  [/^\.pgpass$/, 'database passwords'],
  [/^\.my\.cnf$/, 'database passwords'],
  [/^\.vault-token$/, 'a Vault token'],
  [/^\.terraform\.d\/credentials\.tfrc\.json$|^\.terraformrc$/, 'Terraform credentials'],
  [/^\.cargo\/credentials(\.toml)?$/, 'crates.io credentials'],
  [/^\.gem\/credentials$/, 'RubyGems credentials'],
  [/^\.claude\/\.credentials\.json$/, 'Claude Code login credentials'],
  [/^\.codex\/auth\.json$/, 'Codex login credentials'],
  [/^\.gemini\/oauth_creds\.json$/, 'Gemini CLI login credentials'],
  [/^\.config\/github-copilot\/(hosts|apps)\.json$/, 'GitHub Copilot credentials'],
  [/^\.password-store\/.+/, 'password store entries'],
  [/^\.local\/share\/keyrings\/.+/, 'keyring contents'],
  [/^Library\/Keychains\/.+/, 'keychain contents'],
];

const PEEK_BYTES = 64 * 1024;

function peek(abs: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(PEEK_BYTES);
    const n = readSync(fd, buf, 0, PEEK_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export interface SensitiveFile {
  /** What the file holds, for messages: "secrets from .env.local", "an SSH private key". */
  what: string;
  path: ResolvedPath;
}

/**
 * Whether a path names a file that holds secrets. With `peek`, files whose
 * name alone does not decide it (`*.pem`, `.npmrc` in a project, service
 * account JSON) are opened and checked for a private key or a literal token.
 */
export function sensitiveFile(input: string, ctx: PathCheckContext, options: { peek?: boolean } = {}): SensitiveFile | null {
  if (!input || /^-/.test(input) || /[*?]/.test(input)) return null;
  const path = resolveUserPath(input, ctx);
  const { base, homeRel, abs } = path;
  const found = (what: string): SensitiveFile => ({ what, path });
  if (homeRel !== null) {
    for (const [re, what] of HOME_SECRETS) if (re.test(homeRel)) return found(what);
  }
  if (abs === '/etc/shadow' || abs === '/etc/gshadow') return found('password hashes');
  if (base === '.envrc' || base === '.dev.vars') return found(`secrets from ${base}`);
  if (isEnvFileName(base) && !/\.(vault)$/.test(base)) return found(`secrets from ${base}`);
  if (base === 'secrets.toml' && /(^|\/)\.streamlit\//.test(abs)) return found('Streamlit secrets');
  if (PRIVATE_KEY_NAME.test(base)) return found('an SSH private key');
  if (KEY_EXT.test(base)) return found('a private key');
  const content = options.peek ? peek(abs) : null;
  if (PEM_EXT.test(base)) {
    if (!options.peek) return null;
    return content && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) ? found('a private key') : null;
  }
  if (/service[-_]?account[\w.-]*\.json$|-firebase-adminsdk-[\w-]+\.json$|(^|[-_])gcp[-_]?key\.json$/i.test(base)) {
    if (!options.peek) return found('a cloud service account key');
    return content === null || /"private_key"\s*:/.test(content) ? found('a cloud service account key') : null;
  }
  if (base === 'credentials.json' && options.peek && content && /"(private_key|client_secret)"\s*:\s*"[^"]{8,}/.test(content)) return found('cloud credentials');
  if ((base === '.npmrc' || base === '.yarnrc.yml') && content && /(_auth(Token)?|npmAuth(Token|Ident))\s*[=:]\s*["']?(?!\$\{)[^\s"'$]{8,}/.test(content)) return found('a package registry token');
  if (base === '.pypirc' && content && /^\s*password\s*[:=]\s*(?!\$\{)\S{8,}/m.test(content)) return found('a PyPI token');
  if (base === 'local.settings.json' && content && /"Values"\s*:/.test(content) && /(AccountKey|Password|Secret|ConnectionString)/i.test(content)) return found('Azure Functions secrets');
  return null;
}

/** Entries in `commands.allow` that allow reading a path: `Read(<glob>)`, or a bare path or glob. */
export function readAllowed(input: string, ctx: PathCheckContext): boolean {
  const path = resolveUserPath(input, ctx);
  const patterns: string[] = [];
  for (const entry of ctx.config?.commands?.allow ?? []) {
    const m = /^Read\((.+)\)$/.exec(entry.trim());
    if (m) patterns.push((m[1] as string).trim());
    else if (!/\s/.test(entry.trim()) && /[./]/.test(entry)) patterns.push(entry.trim());
  }
  if (patterns.length === 0) return false;
  const candidates = [path.rel, path.homeRel !== null ? `~/${path.homeRel}` : null, path.abs, input.trim()].filter((c): c is string => c !== null && c !== '');
  return candidates.some((c) => matchesAny(c.replace(/^\.\//, ''), patterns.map((p) => p.replace(/^\.\//, ''))));
}

export function readVerdict(file: SensitiveFile, via: string | null): ActionVerdict {
  const shown = file.path.shown;
  return {
    rule: 'secret/read-sensitive-file',
    decision: 'ask',
    reason: via
      ? `\`${via}\` reads ${shown}, which puts ${file.what} into the model context and the session transcript.`
      : `Reading ${shown} puts ${file.what} into the model context and the session transcript.`,
    fix: 'Ask the user for the variable names you need, or read an example file such as .env.example; a person can allow this path with "Read(<path>)" in commands.allow in ubon.json.',
  };
}

/** secret/read-sensitive-file for a read tool (Read, view, read_file, beforeReadFile). */
export function checkReadPath(path: string, ctx: PathCheckContext): ActionVerdict[] {
  if (disabled(ctx, 'secret/read-sensitive-file')) return [];
  const file = sensitiveFile(path, ctx, { peek: true });
  if (!file || readAllowed(path, ctx)) return [];
  return [readVerdict(file, null)];
}

// ---------------------------------------------------------------------------
// Protected paths

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'pubspec.lock',
  'mix.lock',
]);

const PROJECT_PROTECTED: Array<[RegExp, string]> = [
  [/^ubon\.json$/, "it is Ubon's own configuration"],
  [/^\.ubon\//, "it holds Ubon's baseline of accepted findings"],
  [/(^|\/)\.claude\/settings(\.local)?\.json$/, 'it holds Claude Code hooks and permissions'],
  [/(^|\/)\.claude\/hooks\//, 'it is a Claude Code hook script'],
  [/(^|\/)\.cursor\/(hooks\.json|cli\.json)$/, 'it holds Cursor hooks or permissions'],
  [/(^|\/)\.cursor\/hooks\//, 'it is a Cursor hook script'],
  [/(^|\/)\.codex\/(config\.toml|hooks\.json)$/, 'it holds Codex hooks, sandbox, and approval settings'],
  [/(^|\/)\.codex\/hooks\//, 'it is a Codex hook script'],
  [/(^|\/)\.gemini\/settings\.json$/, 'it holds Gemini CLI hooks and settings'],
  [/(^|\/)\.gemini\/hooks\//, 'it is a Gemini CLI hook script'],
  [/(^|\/)\.github\/hooks\//, 'it holds GitHub Copilot hooks'],
  [/(^|\/)\.github\/copilot\/settings(\.local)?\.json$/, 'it holds GitHub Copilot hooks and settings'],
  [/(^|\/)\.github\/workflows\/[^/]+$/, 'it is a CI workflow'],
  [/^\.gitlab-ci\.ya?ml$|^\.circleci\/config\.ya?ml$/, 'it is CI configuration'],
  [/(^|\/)(\.github\/|docs\/|\.gitlab\/)?CODEOWNERS$/, 'it decides who must review changes'],
  [/(^|\/)\.git(\/|$)/, "it is git's internal state"],
  [/(^|\/)\.husky\//, 'it is a git hook managed by husky'],
  [/(^|\/)\.githooks\//, 'it is a git hook script'],
  [/(^|\/)(\.?lefthook(-local)?\.ya?ml)$/, 'it configures git hooks (lefthook)'],
  [/(^|\/)\.pre-commit-config\.ya?ml$/, 'it configures git hooks (pre-commit)'],
  [/(^|\/)\.?simple-git-hooks\.(json|js|cjs)$/, 'it configures git hooks (simple-git-hooks)'],
];

const HOME_PROTECTED: Array<[RegExp, string]> = [
  [/^\.claude\/settings\.json$|^\.claude\/hooks\//, 'it holds your Claude Code hooks and permissions'],
  [/^\.codex\/(config\.toml|hooks\.json)$/, 'it holds your Codex hooks and approval settings'],
  [/^\.cursor\/hooks\.json$/, 'it holds your Cursor hooks'],
  [/^\.gemini\/settings\.json$/, 'it holds your Gemini CLI hooks and settings'],
  [/^\.copilot\/(hooks\/.*|settings\.json|config\.json)$/, 'it holds your GitHub Copilot hooks and settings'],
  [/^\.gitconfig$|^\.config\/git\/config$/, 'it is your global git configuration (it can turn off git hooks)'],
];

export interface ProtectedPath {
  why: string;
  path: ResolvedPath;
}

export function protectedPath(input: string, ctx: PathCheckContext): ProtectedPath | null {
  if (!input || /^-/.test(input)) return null;
  const path = resolveUserPath(input, ctx);
  if (path.rel !== null && path.rel !== '') {
    // A stale lock file left by a crashed git command is safe to remove.
    if (/(^|\/)\.git\/(index|HEAD|[\w/.-]+)\.lock$/.test(path.rel)) return null;
    for (const [re, why] of PROJECT_PROTECTED) if (re.test(path.rel)) return { why, path };
    if (LOCKFILES.has(path.base)) return { why: 'it is a lockfile, which the package manager maintains', path };
  }
  if (path.homeRel !== null) {
    for (const [re, why] of HOME_PROTECTED) if (re.test(path.homeRel)) return { why, path };
  }
  return null;
}

export function writeVerdict(p: ProtectedPath, via: string | null): ActionVerdict {
  const lockfile = /lockfile/.test(p.why);
  return {
    rule: 'agent/protected-path-write',
    decision: 'ask',
    reason: via ? `\`${via}\` changes ${p.path.shown}; ${p.why}.` : `The agent wants to change ${p.path.shown}; ${p.why}.`,
    fix: lockfile
      ? 'Change dependencies with the package manager (npm install, pnpm add) so it updates the lockfile.'
      : 'Explain the change to the user and let them approve it; the checks should not be changed by the agent they check.',
  };
}

/** agent/protected-path-write for a write or edit tool. */
export function checkWritePath(path: string, ctx: PathCheckContext): ActionVerdict[] {
  if (disabled(ctx, 'agent/protected-path-write')) return [];
  const p = protectedPath(path, ctx);
  if (!p) return [];
  if (writeAllowed(path, ctx)) return [];
  return [writeVerdict(p, null)];
}

/** `Write(<glob>)` or `Edit(<glob>)` entries in commands.allow. */
export function writeAllowed(input: string, ctx: PathCheckContext): boolean {
  const path = resolveUserPath(input, ctx);
  const patterns: string[] = [];
  for (const entry of ctx.config?.commands?.allow ?? []) {
    const m = /^(?:Write|Edit)\((.+)\)$/.exec(entry.trim());
    if (m) patterns.push((m[1] as string).trim().replace(/^\.\//, ''));
  }
  if (patterns.length === 0 || path.rel === null) return false;
  return matchesAny(path.rel, patterns);
}

export function disabled(ctx: Pick<CommandContext, 'config'>, rule: string): boolean {
  const rules = ctx.config?.rules ?? {};
  return rules[rule] === 'off' || (rules[rule] === undefined && rules[`${rule.split('/')[0]}/*`] === 'off');
}
