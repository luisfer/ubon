import { isInside, isUpstream, parseShell, type ShellCommand, shellPayloadWord } from '../../lang/shell.ts';
import type { Rule, TextContext } from '../types.ts';
import { looksLikePowerShell } from './commands.ts';
import { HOOK_KINDS, type ConfigKind, configKind, hookSection, parseConfig } from './config-files.ts';
import { fileRole } from './file-roles.ts';
import { effectiveArgv, effectiveName, hostOf, isInterpreter, isLocalHost, oneLine, runsStdinAsCode, urlArgs } from './shell-analysis.ts';

/**
 * Hook commands that are easy to turn against the user: deletions with an
 * unquoted variable in the path, `eval` of hook input, and requests to hosts
 * outside this machine. Hooks run on every matching event with the user's
 * permissions and receive prompts, file contents, and command output.
 */

const NETWORK = new Set(['curl', 'wget', 'wget2', 'http', 'https', 'xh', 'nc', 'ncat', 'netcat', 'socat', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
const KNOWN_ROOTS = /^\$\{?(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|GEMINI_PROJECT_DIR|CURSOR_PROJECT_DIR|PLUGIN_ROOT|PLUGIN_DATA|HOME|PWD)\}?/;

export interface HookProblem {
  message: string;
  key: string;
}

export function hookCommandProblems(command: string, dialect?: 'sh' | 'powershell'): HookProblem[] {
  const parse = parseShell(command, { dialect: dialect ?? (looksLikePowerShell(command) ? 'powershell' : 'sh') });
  const out: HookProblem[] = [];
  const seen = new Set<string>();
  const add = (p: HookProblem) => {
    if (seen.has(p.key)) return;
    seen.add(p.key);
    out.push(p);
  };
  for (const c of parse.commands) {
    const name = effectiveName(c);
    const argv = effectiveArgv(c);
    const words = c.words.slice(c.argv.length - argv.length);
    // rm -rf $DIR/ ...
    if ((name === 'rm' || name === 'rimraf') && c.dialect === 'sh') {
      const recursive = name === 'rimraf' || argv.slice(1).some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
      if (recursive) {
        for (const w of words.slice(1)) {
          const lead = w.expansions.find((e) => e.at === 0 && e.kind === 'var');
          if (!lead || lead.quoted || KNOWN_ROOTS.test(lead.text) || /^\$\{[^}]*:[?-]/.test(lead.text)) continue;
          add({ message: `\`${oneLine(c.text, 60)}\` deletes a path built from the unquoted variable ${lead.text}; if it is empty or has spaces, other files are deleted.`, key: `rm:${lead.text}` });
        }
      }
    }
    // eval of hook input: eval "$(cat)", eval $(jq -r ...), bash -c "$INPUT", jq -r .cmd | sh
    if (name === 'eval' && c.dialect === 'sh' && words.slice(1).some((w) => w.expansions.length > 0)) {
      add({ message: `\`${oneLine(c.text, 60)}\` evaluates text built at run time, which in a hook usually comes from the event payload.`, key: 'eval' });
    }
    const payload = shellPayloadWord(c);
    if (payload && payload.word.expansions.some((e) => e.kind === 'command' || (e.kind === 'var' && !KNOWN_ROOTS.test(e.text)))) {
      add({ message: `\`${oneLine(c.text, 60)}\` runs code built at run time with ${c.name} -c, which in a hook usually comes from the event payload.`, key: 'shell-c' });
    }
    if (runsStdinAsCode(c) && isInterpreter(c.name.toLowerCase())) {
      const feeder = parse.commands.find((u) => u !== c && isUpstream(u, c) && ['cat', 'jq', 'yq', 'tee', 'echo', 'printf'].includes(u.name));
      if (feeder) add({ message: `\`${oneLine(`${feeder.text} | ${c.text}`, 60)}\` runs its input as code, which in a hook is the event payload.`, key: 'stdin' });
    }
    const first = words[0];
    if (first && first.expansions.some((e) => e.kind === 'command' && e.at === 0)) {
      // "$(git rev-parse --show-toplevel)/scripts/x" finds a path; it does not read the payload.
      const firstIndex = c.argv.length - argv.length;
      const inner = parse.commands.filter((u) => isInside(u, c) && topmostUnder(u, c).parentWord === firstIndex);
      if (inner.length === 0 || !inner.every(findsLocation)) {
        add({ message: `\`${oneLine(c.text, 60)}\` runs a command whose name comes from a command substitution, which in a hook usually comes from the event payload.`, key: 'dynamic' });
      }
    }
    // Requests to hosts outside this machine.
    if (NETWORK.has(name)) {
      const hosts = urlArgs(argv.slice(1)).map(hostOf).filter((h): h is string => h !== null && !isLocalHost(h));
      if (hosts.length > 0) add({ message: `The hook calls ${name} on ${hosts[0]}; hooks receive prompts, file contents, and command output, so check what it sends there.`, key: `net:${hosts[0]}` });
    }
  }
  return out;
}

/** The ancestor of `u` that is a direct child of `outer` (or `u` itself). */
function topmostUnder(u: ShellCommand, outer: ShellCommand): ShellCommand {
  let x = u;
  while (x.parent && x.parent !== outer) x = x.parent;
  return x;
}

/** Commands that print a directory or a program's location and read nothing from stdin. */
function findsLocation(c: ShellCommand): boolean {
  const [, sub, arg] = c.argv;
  switch (c.name) {
    case 'pwd':
    case 'dirname':
    case 'basename':
    case 'realpath':
    case 'readlink':
    case 'which':
    case 'cd':
      return true;
    case 'git':
      return sub === 'rev-parse';
    case 'command':
    case 'type':
      return sub === '-v' || sub === '-p' || sub === '-P';
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return sub === 'root' || sub === 'prefix' || sub === 'bin' || (sub === 'config' && arg === 'get');
    case 'brew':
      return sub === '--prefix';
    default:
      return false;
  }
}

function scriptProblems(ctx: TextContext): Array<HookProblem & { line: number }> {
  const out: Array<HookProblem & { line: number }> = [];
  const lines = ctx.lines;
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let text = lines[i] as string;
    while (/\\\s*$/.test(text) && i + 1 < lines.length) {
      i++;
      text = `${text.replace(/\\\s*$/, '')} ${lines[i]}`;
    }
    if (/^\s*(#|$)/.test(text)) continue;
    for (const p of hookCommandProblems(text, /\.ps1$/i.test(ctx.file.path) ? 'powershell' : 'sh')) out.push({ ...p, line: start + 1 });
  }
  return out;
}

export const unsafeHookScript: Rule = {
  meta: {
    id: 'agent/unsafe-hook-script',
    level: 'warn',
    scope: 'file',
    title: 'Unsafe agent hook command',
    summary: 'Agent hook commands and hook scripts with an unquoted variable in a recursive delete (`rm -rf $DIR/`), `eval` of text built at run time (usually the hook input), or requests to hosts outside this machine.',
    why: 'Hooks run on every matching event with your permissions and receive prompts, file contents, and command output. An empty variable turns a cleanup into `rm -rf /`, evaluating the payload lets a prompt injection run commands, and a request to another host can send what the hook received.',
    fix: 'Quote variables in paths ("$DIR"), read fields from the payload as data instead of evaluating them, and send hook data only to hosts you control.',
    cwe: ['CWE-78', 'CWE-95'],
    owasp: ['ASI02', 'ASI05'],
  },
  appliesTo: (file) => !file.generated && !file.contexts.has('test') && (HOOK_KINDS.has(configKind(file.path) as ConfigKind) || (fileRole(file.path) === 'hook-script' && !/(^|\/)(\.husky|\.githooks|\.devcontainer)\//.test(file.path))),
  text(ctx) {
    const kind = configKind(ctx.file.path);
    if (!kind) {
      for (const p of scriptProblems(ctx)) ctx.report({ line: p.line, message: p.message, key: p.key });
      return;
    }
    const doc = parseConfig(ctx.file.path, ctx.text, kind);
    if (!doc?.data) return;
    for (const h of hookSection(doc, ctx.project.files)?.handlers ?? []) {
      for (const c of h.commands) {
        for (const p of hookCommandProblems(c.text, c.dialect)) ctx.report({ line: c.line, message: `${h.event} hook: ${lowerFirst(p.message)}`, key: `${h.event}:${p.key}` });
      }
      if (h.type === 'http' && h.url) {
        const host = hostOf(h.url);
        if (host && !isLocalHost(host)) {
          ctx.report({ line: h.line, message: `${h.event} hook: the HTTP hook posts every event to ${host}; hooks receive prompts, file contents, and command output.`, key: `${h.event}:http:${host}` });
        }
      }
    }
  },
};

function lowerFirst(s: string): string {
  return s.startsWith('`') ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

