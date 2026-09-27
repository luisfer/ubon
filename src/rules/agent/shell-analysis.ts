import { commandName, isInside, isShellInterpreter, isUpstream, parseArgs, shellPayloadWord, type ShellCommand, type ShellParse } from '../../lang/shell.ts';

/**
 * Facts about parsed shell commands shared by the command checks and the file
 * rules that read commands from hooks, scripts, and docs: which commands fetch
 * from the network, which run code from stdin, and where remote content is
 * executed.
 */

// ---------------------------------------------------------------------------
// Effective command

const PM_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  pnpm: new Set(['add', 'install', 'i', 'update', 'up', 'upgrade', 'remove', 'rm', 'uninstall', 'un', 'link', 'ln', 'unlink', 'import', 'rebuild', 'rb', 'prune', 'fetch', 'patch', 'patch-commit', 'patch-remove', 'audit', 'list', 'ls', 'll', 'outdated', 'why', 'exec', 'run', 'run-script', 'test', 't', 'start', 'dlx', 'create', 'init', 'publish', 'pack', 'store', 'env', 'setup', 'server', 'config', 'c', 'get', 'set', 'deploy', 'licenses', 'root', 'bin', 'doctor', 'recursive', 'self-update', 'approve-builds', 'ignored-builds', 'dedupe', 'catalog', 'version', 'help', 'completion', 'login', 'logout', 'whoami', 'owner', 'dist-tag', 'unpublish', 'deprecate', 'search', 'view', 'info', 'docs', 'repo', 'ping', 'cat-file', 'cat-index', 'find-hash', 'restart', 'stop', 'sbom']),
  yarn: new Set(['add', 'install', 'remove', 'upgrade', 'upgrade-interactive', 'up', 'run', 'dlx', 'exec', 'create', 'init', 'publish', 'pack', 'info', 'why', 'workspaces', 'workspace', 'config', 'cache', 'set', 'plugin', 'version', 'node', 'npm', 'constraints', 'explain', 'dedupe', 'rebuild', 'link', 'unlink', 'patch', 'patch-commit', 'bin', 'global', 'audit', 'outdated', 'list', 'licenses', 'login', 'logout', 'owner', 'tag', 'team', 'test', 'check', 'import', 'policies', 'autoclean', 'help', 'start', 'search', 'stage', 'unplug', 'sdks', 'generate-lock-entry']),
  bun: new Set(['add', 'a', 'install', 'i', 'remove', 'rm', 'update', 'run', 'x', 'create', 'c', 'init', 'build', 'test', 'pm', 'link', 'unlink', 'publish', 'outdated', 'upgrade', 'patch', 'patch-commit', 'audit', 'info', 'why', 'exec', 'repl', 'completions', 'discord', 'help', 'feedback']),
};

/**
 * The argv that actually runs: `pnpm prisma migrate reset` and `yarn prisma ...`
 * run the prisma binary; everything else is the command's own argv.
 */
export function effectiveArgv(cmd: ShellCommand): string[] {
  const subs = PM_SUBCOMMANDS[cmd.name];
  const next = cmd.argv[1];
  if (subs && next !== undefined && !next.startsWith('-') && !subs.has(next) && !/[./\\]/.test(next)) return cmd.argv.slice(1);
  if ((cmd.name === 'npm' || cmd.name === 'pnpm' || cmd.name === 'yarn' || cmd.name === 'bun') && next === 'exec' && cmd.argv[2] !== undefined) {
    const rest = cmd.argv.slice(2);
    return rest[0] === '--' ? rest.slice(1) : rest;
  }
  return cmd.argv;
}

export function effectiveName(cmd: ShellCommand): string {
  return commandName(effectiveArgv(cmd)[0] ?? '', cmd.dialect).toLowerCase();
}

// ---------------------------------------------------------------------------
// Network

export function hostOf(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@\s]*@)?(\[[^\]]+\]|[^/:?#\s]+)/i.exec(url.trim());
  return m ? (m[1] as string).toLowerCase() : null;
}

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1|host\.docker\.internal|[\w.-]+\.localhost|[\w.-]+\.local|[\w.-]+\.internal|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;

export function isLocalHost(host: string): boolean {
  return LOCAL_HOST.test(host.toLowerCase());
}

const URL_RE = /^(?:https?|ftp|ftps):\/\//i;

export function urlArgs(argv: readonly string[]): string[] {
  return argv.filter((a) => URL_RE.test(a) || /^[\w.-]+\.[a-z]{2,}(?::\d+)?\/\S*$/i.test(a));
}

const PS_FETCH = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'wget', 'curl', 'start-bitstransfer']);

/**
 * The fetch names something to fetch: a URL, a host and path, or a variable
 * or substitution that holds one. `curl ... | sh` in prose is a placeholder.
 */
function hasFetchTarget(cmd: ShellCommand): boolean {
  const argv = effectiveArgv(cmd);
  if (urlArgs(argv.slice(1)).length > 0) return true;
  const words = cmd.words.slice(cmd.argv.length - argv.length + 1);
  return words.some((w) => !w.value.startsWith('-') && w.expansions.length > 0);
}

/**
 * A command that fetches remote content and writes it to stdout (so it can be
 * piped): curl without -o, wget -O-, httpie, PowerShell iwr/irm.
 */
export function fetchesToStdout(cmd: ShellCommand): boolean {
  return fetchesToStdoutShape(cmd) && hasFetchTarget(cmd);
}

function fetchesToStdoutShape(cmd: ShellCommand): boolean {
  const name = effectiveName(cmd);
  const args = effectiveArgv(cmd).slice(1);
  if (cmd.dialect === 'powershell' && PS_FETCH.has(name)) return !args.some((a) => /^-outf/i.test(a));
  switch (name) {
    case 'curl': {
      const p = parseArgs(args, 0, CURL_VALUE_FLAGS);
      if (p.flags.has('O') || p.flags.has('remote-name') || p.flags.has('remote-name-all')) return false;
      const out = p.values.get('o') ?? p.values.get('output');
      if (out && out.some((o) => o !== '-' && o !== '/dev/stdout')) return false;
      return true;
    }
    case 'wget':
    case 'wget2': {
      const p = parseArgs(args, 0, new Set(['O', 'output-document', 'o', 'a', 'e', 'P', 'U', 'user-agent', 'header', 't', 'T', 'w']));
      const out = p.values.get('O') ?? p.values.get('output-document');
      return !!out && out.some((o) => o === '-' || o === '/dev/stdout');
    }
    case 'fetch': {
      const p = parseArgs(args, 0, new Set(['o']));
      return (p.values.get('o') ?? []).includes('-');
    }
    case 'http':
    case 'https':
    case 'xh':
    case 'xhs':
    case 'lwp-request':
    case 'get':
      return urlArgs(args).length > 0;
    default:
      return false;
  }
}

/** The file a download command writes, for `curl -o x.sh URL && sh x.sh`. */
export function downloadTarget(cmd: ShellCommand): string | null {
  const name = effectiveName(cmd);
  const args = effectiveArgv(cmd).slice(1);
  if (cmd.dialect === 'powershell' && PS_FETCH.has(name)) {
    const i = args.findIndex((a) => /^-outf(ile)?$/i.test(a));
    return i >= 0 ? (args[i + 1] ?? null) : null;
  }
  if (name === 'curl') {
    const p = parseArgs(args, 0, CURL_VALUE_FLAGS);
    const out = p.values.get('o') ?? p.values.get('output');
    if (out && out[0] && out[0] !== '-') return out[0];
    if (p.flags.has('O') || p.flags.has('remote-name')) {
      const url = urlArgs(p.operands)[0];
      return url ? basenameOfUrl(url) : null;
    }
    return null;
  }
  if (name === 'wget' || name === 'wget2') {
    const p = parseArgs(args, 0, new Set(['O', 'output-document', 'o', 'a', 'e', 'P', 'U', 't', 'T', 'w']));
    const out = p.values.get('O') ?? p.values.get('output-document');
    if (out && out[0] && out[0] !== '-') return out[0];
    const url = urlArgs(p.operands)[0];
    return url ? basenameOfUrl(url) : null;
  }
  return null;
}

function basenameOfUrl(url: string): string | null {
  const path = url.replace(/[?#].*$/, '').replace(/^[a-z]+:\/\/[^/]+/i, '');
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base || null;
}

export const CURL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  'o', 'output', 'd', 'data', 'data-binary', 'data-raw', 'data-urlencode', 'data-ascii', 'json', 'F', 'form', 'form-string',
  'T', 'upload-file', 'H', 'header', 'X', 'request', 'u', 'user', 'A', 'user-agent', 'e', 'referer', 'b', 'cookie', 'c', 'cookie-jar',
  'm', 'max-time', 'connect-timeout', 'retry', 'x', 'proxy', 'w', 'write-out', 'K', 'config', 'E', 'cert', 'key', 'cacert', 'r', 'range',
  'url', 'resolve', 'connect-to', 'interface', 'retry-delay', 'retry-max-time', 'max-filesize', 'limit-rate', 'Y', 'y', 'z', 'C',
]);

/** A command that decodes hidden content (`base64 -d`, `xxd -r`, `openssl enc -d -base64`, `printf '\x..'`). */
export function isDecoder(cmd: ShellCommand): boolean {
  const name = effectiveName(cmd);
  const args = effectiveArgv(cmd).slice(1);
  if (name === 'base64' || name === 'base32' || name === 'basenc') return args.some((a) => a === '-d' || a === '--decode' || a === '-D' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(a));
  if (name === 'openssl') return (args[0] === 'base64' || args[0] === 'enc') && args.includes('-d');
  if (name === 'xxd') return args.some((a) => a === '-r' || /^-r[p]?$/.test(a) || a === '-revert');
  if (name === 'uudecode') return true;
  if (name === 'printf') return args.some((a) => /\\x[0-9a-f]{2}|\\[0-7]{3}/i.test(a));
  if (name === 'echo') return args.some((a) => a === '-e') && args.some((a) => /\\x[0-9a-f]{2}|\\[0-7]{3}/i.test(a));
  if (name === 'frombase64string' || (cmd.dialect === 'powershell' && /FromBase64String/i.test(cmd.text))) return true;
  return false;
}

const CODE_INTERPRETERS = new Set(['python', 'python2', 'python3', 'node', 'nodejs', 'perl', 'ruby', 'php', 'lua', 'deno', 'bun', 'osascript', 'pwsh', 'powershell', 'tclsh', 'Rscript']);

export function isInterpreter(name: string): boolean {
  return isShellInterpreter(name) || CODE_INTERPRETERS.has(name) || /^python\d(\.\d+)?$/.test(name);
}

/** True when the command runs code it reads from stdin: `sh`, `bash -s`, `python -`, `node`, `iex`, `source /dev/stdin`. */
export function runsStdinAsCode(cmd: ShellCommand): boolean {
  const name = cmd.name.toLowerCase();
  const args = cmd.argv.slice(1);
  if (cmd.dialect === 'powershell' && (name === 'iex' || name === 'invoke-expression')) return true;
  if (name === 'source' || name === '.') return args.some((a) => a === '/dev/stdin' || a === '/proc/self/fd/0' || a === '-');
  if (name === 'pwsh' || name === 'powershell') return args.some((a) => a === '-') || (args.length > 0 && /^-c(ommand)?$/i.test(args[0] as string) && args[1] === '-');
  if (!isInterpreter(name)) return false;
  if (name === 'deno' || name === 'bun') return args[0] === 'run' && args[1] === '-';
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '-' || a === '-s' || a === '/dev/stdin') return true;
    if (a === '--') return i + 1 >= args.length || args[i + 1] === '-';
    if (isShellInterpreter(name) && (a === '-c' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))) return false;
    if (!isShellInterpreter(name) && (a === '-c' || a === '-e' || a === '-m' || a === '--eval' || a === '-p' || a === '--print' || a === '-r')) return false;
    if (a === '-o' || a === '+o' || a === '-O' || a === '+O' || a === '-W' || a === '-X') {
      i++;
      continue;
    }
    if (a.startsWith('-') || a.startsWith('+')) continue;
    return false; // a script file operand
  }
  return true;
}

/** Code passed inline to an interpreter: `sh -c CODE`, `python -c CODE`, `node -e CODE`. */
export function inlineCodeWordIndex(cmd: ShellCommand): number | null {
  const payload = shellPayloadWord(cmd);
  if (payload) return payload.index;
  const name = cmd.name.toLowerCase();
  if (!CODE_INTERPRETERS.has(name) && !/^python\d/.test(name)) return null;
  for (let i = 1; i < cmd.argv.length; i++) {
    const a = cmd.argv[i] as string;
    if (a === '-c' || a === '-e' || a === '--eval' || a === '-p' || a === '--print' || a === '-r') return i + 1 < cmd.argv.length ? i + 1 : null;
    if (!a.startsWith('-')) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Remote code execution

export type RemoteExecKind = 'pipe' | 'process-substitution' | 'inline' | 'eval' | 'download-run' | 'powershell' | 'decode' | 'ansi-c' | 'encoded';

export interface RemoteExec {
  /** The command that runs the code. */
  command: ShellCommand;
  kind: RemoteExecKind;
  /** The fetch or decode command, when there is one. */
  source: ShellCommand | null;
  /** True for fetched content; false for decoded or escaped content (obfuscation). */
  remote: boolean;
}

function childOf(parse: ShellParse, owner: ShellCommand, pred: (c: ShellCommand) => boolean): ShellCommand | null {
  return parse.commands.find((c) => c !== owner && isInside(c, owner) && pred(c)) ?? null;
}

/** Commands inside a given argument of `owner` (substitutions in that argument, at any depth). */
export function childrenInWord(parse: ShellParse, owner: ShellCommand, wordIndex: number): ShellCommand[] {
  const direct = parse.commands.filter((c) => c.parent === owner && c.parentWord === wordIndex);
  return parse.commands.filter((c) => direct.includes(c) || direct.some((d) => isInside(c, d)));
}

const FETCH_TEXT = /Download(String|File|Data)\s*\(\s*['"]?(https?:|\$)/i;

/** Remote or hidden content executed by a command line. */
export function findRemoteExecution(parse: ShellParse): RemoteExec[] {
  const out: RemoteExec[] = [];
  const commands = parse.commands;
  const seen = new Set<ShellCommand>();
  const add = (e: RemoteExec) => {
    if (seen.has(e.command)) return;
    seen.add(e.command);
    out.push(e);
  };
  for (const cmd of commands) {
    const name = cmd.name.toLowerCase();
    // 1. fetch | interpreter
    if (runsStdinAsCode(cmd)) {
      const fetcher = commands.find((c) => c !== cmd && isUpstream(c, cmd) && fetchesToStdout(c));
      if (fetcher) {
        add({ command: cmd, kind: 'pipe', source: fetcher, remote: true });
        continue;
      }
      const decoder = commands.find((c) => c !== cmd && isUpstream(c, cmd) && isDecoder(c));
      if (decoder) {
        add({ command: cmd, kind: 'decode', source: decoder, remote: false });
        continue;
      }
    }
    // 2. bash <(curl ...), source <(curl ...)
    if (isInterpreter(name) || name === 'source' || name === '.') {
      const proc = commands.find((c) => c.parent === cmd && c.origin === 'process-substitution' && fetchesToStdout(c));
      if (proc) {
        add({ command: cmd, kind: 'process-substitution', source: proc, remote: true });
        continue;
      }
    }
    // 3. sh -c "$(curl ...)", python -c "$(curl ...)"
    const codeIndex = inlineCodeWordIndex(cmd);
    if (codeIndex !== null) {
      const inner = childrenInWord(parse, cmd, codeIndex);
      const fetcher = inner.find((c) => fetchesToStdout(c)) ?? null;
      if (fetcher) {
        add({ command: cmd, kind: 'inline', source: fetcher, remote: true });
        continue;
      }
      const decoder = inner.find((c) => isDecoder(c)) ?? null;
      if (decoder) {
        add({ command: cmd, kind: 'decode', source: decoder, remote: false });
        continue;
      }
    }
    // 4. eval "$(curl ...)", eval "$(echo ... | base64 -d)"
    if (name === 'eval' && cmd.dialect === 'sh') {
      const fetcher = childOf(parse, cmd, fetchesToStdout);
      if (fetcher) {
        add({ command: cmd, kind: 'eval', source: fetcher, remote: true });
        continue;
      }
      const decoder = childOf(parse, cmd, isDecoder);
      if (decoder) {
        add({ command: cmd, kind: 'decode', source: decoder, remote: false });
        continue;
      }
    }
    // 5. PowerShell: iex (iwr ...), iex ((New-Object Net.WebClient).DownloadString(...)), irm ... | iex
    if (cmd.dialect === 'powershell' && (name === 'iex' || name === 'invoke-expression')) {
      const argsText = cmd.words.slice(1).map((w) => w.raw).join(' ');
      const fetcher = childOf(parse, cmd, (c) => fetchesToStdout(c) || FETCH_TEXT.test(c.text));
      if (fetcher || FETCH_TEXT.test(argsText)) {
        add({ command: cmd, kind: 'powershell', source: fetcher, remote: true });
        continue;
      }
      const upstream = commands.find((c) => c !== cmd && isUpstream(c, cmd) && (fetchesToStdout(c) || FETCH_TEXT.test(c.text)));
      if (upstream) {
        add({ command: cmd, kind: 'powershell', source: upstream, remote: true });
        continue;
      }
      if (/FromBase64String/i.test(cmd.text) || commands.some((c) => c !== cmd && (isUpstream(c, cmd) || isInside(c, cmd)) && isDecoder(c))) {
        add({ command: cmd, kind: 'decode', source: null, remote: false });
        continue;
      }
    }
    // 6. $(curl ...) or `curl ...` as the command itself
    const first = cmd.words[0];
    if (first && first.expansions.some((e) => e.kind === 'command' && e.at === 0) && first.value.startsWith(first.expansions[0]?.text ?? '\0')) {
      const fetcher = childOf(parse, cmd, fetchesToStdout);
      if (fetcher) {
        add({ command: cmd, kind: 'eval', source: fetcher, remote: true });
        continue;
      }
      const decoder = childOf(parse, cmd, isDecoder);
      if (decoder) {
        add({ command: cmd, kind: 'decode', source: decoder, remote: false });
        continue;
      }
    }
    // 7. powershell -EncodedCommand
    if ((name === 'pwsh' || name === 'powershell') && cmd.argv.some((a) => /^-(e|ec|en|enc|enco|encod|encode|encoded|encodedcommand)$/i.test(a))) {
      add({ command: cmd, kind: 'encoded', source: null, remote: false });
      continue;
    }
    // 8. $'\x72\x6d' -rf /: escaped characters in the command name.
    if (first?.ansiC && /\\(x[0-9a-f]|[0-7]{2,3}|u[0-9a-f])/i.test(first.raw)) {
      add({ command: cmd, kind: 'ansi-c', source: null, remote: false });
      continue;
    }
  }
  // 9. curl -o x.sh URL && sh x.sh
  const downloads = commands.map((c) => ({ c, target: downloadTarget(c) })).filter((d): d is { c: ShellCommand; target: string } => d.target !== null);
  for (const d of downloads) {
    const target = normalizeFile(d.target);
    for (const cmd of commands) {
      if (cmd.index <= d.c.index || seen.has(cmd)) continue;
      if (runsFile(cmd, target)) add({ command: cmd, kind: 'download-run', source: d.c, remote: true });
    }
  }
  return out;
}

function normalizeFile(path: string): string {
  return path.replace(/^\.\//, '');
}

function runsFile(cmd: ShellCommand, target: string): boolean {
  const arg0 = normalizeFile(cmd.argv[0] ?? '');
  if (arg0 === target && (cmd.argv[0] ?? '').includes('/')) return true;
  const name = cmd.name.toLowerCase();
  if (isInterpreter(name) || name === 'source' || name === '.') {
    const operand = cmd.argv.slice(1).find((a) => !a.startsWith('-'));
    return operand !== undefined && normalizeFile(operand) === target;
  }
  if (cmd.dialect === 'powershell' && arg0 === target) return true;
  return false;
}

/** Short description of how remote code is run, for messages. */
export function describeRemoteExec(e: RemoteExec): string {
  const src = e.source ? oneLine(e.source.text) : '';
  switch (e.kind) {
    case 'pipe':
      return `pipes the output of \`${src}\` into \`${e.command.name}\``;
    case 'process-substitution':
      return `runs \`${src}\` through \`${e.command.name} <(...)\``;
    case 'inline':
      return `runs the output of \`${src}\` as \`${e.command.name}\` code`;
    case 'eval':
      return `evaluates the output of \`${src}\``;
    case 'download-run':
      return `downloads a script with \`${src}\` and runs it`;
    case 'powershell':
      return 'downloads PowerShell code and runs it with Invoke-Expression';
    case 'decode':
      return e.source ? `decodes hidden content with \`${src}\` and runs it` : 'decodes hidden content and runs it';
    case 'encoded':
      return 'runs a base64-encoded PowerShell command';
    case 'ansi-c':
      return 'spells the command name with escape sequences';
  }
}

export function oneLine(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}
