import { parseShell } from '../../lang/shell.ts';
import type { Rule, TextContext } from '../types.ts';
import { looksLikePowerShell } from './commands.ts';
import { configCommands, configKind, parseConfig } from './config-files.ts';
import { type FileRole, fileRole, markdownSnippets } from './file-roles.ts';
import { effectiveArgv, findRemoteExecution, hostOf, oneLine, type RemoteExec, urlArgs } from './shell-analysis.ts';

/**
 * Remote content piped into an interpreter, in files that agents or tools run
 * or follow: hooks, skills, commands, devcontainer lifecycle commands, package
 * scripts (block), and agent instructions and docs (warn).
 */

const QUICK = /curl|wget|fetch|\biwr\b|\birm\b|Invoke-(WebRequest|RestMethod)|DownloadString|base64|xxd|openssl/i;

export interface PipeFinding {
  exec: RemoteExec;
  snippet: string;
  host: string | null;
}

/** Remote code execution in one command string. */
export function pipeToShellIn(command: string, dialect?: 'sh' | 'powershell', options: { namedInterpreter?: boolean } = {}): PipeFinding | null {
  if (!QUICK.test(command)) return null;
  const parse = parseShell(command, { dialect: dialect ?? (looksLikePowerShell(command) ? 'powershell' : 'sh') });
  const exec = findRemoteExecution(parse).find(
    (e) =>
      e.kind !== 'encoded' &&
      e.kind !== 'ansi-c' &&
      e.kind !== 'download-run' &&
      // A string in program code is only shell code when it names what runs it (`| sh`, `bash -c`, `eval`).
      (!options.namedInterpreter || (e.kind === 'eval' ? e.command.name === 'eval' : true)),
  );
  if (!exec) return null;
  const host = exec.source ? (urlArgs(effectiveArgv(exec.source)).map(hostOf).find(Boolean) ?? null) : null;
  // Show the command without a trailing shell comment; a long one is cut down to the part that fetches and runs.
  const full = oneLine(command.replace(/(^|\s)#(?![!>]).*$/, ''), Number.POSITIVE_INFINITY);
  let snippet = full;
  if (full.length > 90) {
    const run = oneLine(exec.command.text, Number.POSITIVE_INFINITY);
    const source = exec.source ? oneLine(exec.source.text, Number.POSITIVE_INFINITY) : '';
    if (exec.kind === 'pipe' && source) snippet = full.includes(`${source} | ${run}`) ? `${source} | ${run}` : `${source} | ... | ${run}`;
    else snippet = run;
  }
  return { exec, snippet: oneLine(snippet, 90), host };
}

function effect(f: PipeFinding): string {
  if (!f.exec.remote) return 'which decodes hidden content and runs it';
  return f.host ? `which runs whatever ${f.host} serves` : 'which runs whatever the server sends';
}

export const pipeToShell: Rule = {
  meta: {
    id: 'agent/pipe-to-shell',
    level: 'block',
    scope: 'file',
    title: 'Remote script piped into a shell',
    summary: 'Remote content piped into an interpreter (`curl ... | sh`, `wget -O- ... | bash`, `bash <(curl ...)`, `iex (iwr ...)`, `base64 -d | sh`) in hooks, skills, commands, devcontainer lifecycle commands, package scripts, agent instructions, and docs.',
    why: 'The command runs whatever the server returns at that moment, with the permissions of the agent or developer, and nothing records what ran. In hooks and install scripts it runs without anyone starting it; a compromised or hijacked host can change the script at any time.',
    fix: 'Install the tool with a package manager or download a pinned release, verify its checksum, and run the file.',
    cwe: ['CWE-494', 'CWE-829'],
    owasp: ['ASI04', 'ASI05'],
    levels: 'block in hooks, hook scripts, git hooks, skills, commands, devcontainer lifecycle commands, and package.json scripts; warn in agent instructions (AGENTS.md, CLAUDE.md, rules) and in other docs, and in test and example folders.',
  },
  appliesTo: (file) => !file.generated && (configKind(file.path) !== null || fileRole(file.path) !== null),
  text(ctx) {
    const reported = new Set<number>();
    const lowStakes = ctx.file.contexts.has('test') || ctx.file.contexts.has('example');
    const report = (line: number, level: 'block' | 'warn', message: string, key: string) => {
      if (reported.has(line)) return;
      reported.add(line);
      ctx.report({ line, level: lowStakes ? 'warn' : level, message, key });
    };
    const kind = configKind(ctx.file.path);
    if (kind) {
      if (!QUICK.test(ctx.text)) return;
      const doc = parseConfig(ctx.file.path, ctx.text, kind);
      if (!doc?.data) return;
      for (const c of configCommands(doc, ctx.project.files)) {
        const f = pipeToShellIn(c.command, c.dialect);
        if (!f) continue;
        const what = kind === 'package-json' ? `The ${c.label} in package.json` : `The ${c.label}`;
        report(c.line, 'block', `${what} runs \`${f.snippet}\`, ${effect(f)}.`, c.label);
      }
      return;
    }
    const role = fileRole(ctx.file.path) as FileRole;
    if (!QUICK.test(ctx.text)) return;
    if (role === 'hook-script' || (role === 'skill' && !/\.(md|mdx|mdc|txt|toml)$/i.test(ctx.file.path))) {
      scanScript(ctx, role, report);
      return;
    }
    for (const s of markdownSnippets(ctx.text)) {
      const program = s.fenced && !SHELL_LANGS.has(s.lang);
      const candidates = s.fenced ? commandsInCode(s.text, s.lang) : fromProse(s.text);
      for (const text of candidates) {
        const f = pipeToShellIn(text, undefined, { namedInterpreter: program });
        if (!f) continue;
        const level = role === 'skill' ? 'block' : 'warn';
        const subject = role === 'skill' ? 'This skill or command tells the agent to run' : role === 'instructions' ? 'These agent instructions tell the agent to run' : 'This document tells readers to run';
        report(s.line, level, `${subject} \`${f.snippet}\`, ${effect(f)}.`, role);
        break;
      }
    }
  },
};

const SHELL_LANGS = new Set(['', 'sh', 'bash', 'zsh', 'fish', 'ksh', 'shell', 'shellscript', 'shellsession', 'sh-session', 'console', 'terminal', 'powershell', 'pwsh', 'ps', 'ps1', 'posh', 'cmd', 'bat', 'batch', 'text', 'txt', 'plaintext', 'plain']);

/**
 * The commands in one line of a fenced code block. Shell blocks are commands
 * as written; Dockerfile `RUN`, YAML `run:` values, and Makefile recipes are
 * commands after their prefix; in other languages only string literals can
 * hold a command (`exec.Command("bash", "-c", "...")`). Markdown examples are
 * skipped.
 */
function commandsInCode(text: string, lang: string): string[] {
  if (SHELL_LANGS.has(lang)) return [text];
  switch (lang) {
    case 'md':
    case 'markdown':
    case 'mdx':
      return [];
    case 'dockerfile':
    case 'docker':
    case 'containerfile':
      return [text.replace(/^\s*RUN\s+(?:--\S+\s+)*/i, '')];
    case 'yaml':
    case 'yml':
      return [text.replace(/^\s*(?:-\s+)?(?:[\w.-]+:\s*(?:[|>][-+]?\s*)?)?/, '').replace(/^(["'])(.*)\1\s*$/, '$2')];
    case 'makefile':
    case 'make':
      return [text.replace(/^\t[@+-]*/, '')];
    default:
      return stringLiterals(text);
  }
}

/** The contents of the quoted strings in one line of code; an unclosed string runs to the end of the line. */
function stringLiterals(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const q = text[i] as string;
    if (q !== '"' && q !== "'" && q !== '`') {
      i++;
      continue;
    }
    let j = i + 1;
    let body = '';
    while (j < text.length && text[j] !== q) {
      if (text[j] === '\\' && q !== '`' && j + 1 < text.length) {
        body += text[j + 1];
        j += 2;
        continue;
      }
      body += text[j];
      j++;
    }
    if (body.trim()) out.push(body);
    i = j + 1;
  }
  return out;
}

/** In prose, parse from each place a fetch command starts. */
function fromProse(text: string): string[] {
  const out: string[] = [];
  const re = /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|iex|Invoke-Expression|bash|sh|zsh|echo|eval|source)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(text.slice(m.index));
  return out;
}

function scanScript(ctx: TextContext, role: FileRole, report: (line: number, level: 'block' | 'warn', message: string, key: string) => void): void {
  const lines = ctx.lines;
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let text = lines[i] as string;
    while (/\\\s*$/.test(text) && i + 1 < lines.length) {
      i++;
      text = `${text.replace(/\\\s*$/, '')} ${lines[i]}`;
    }
    if (/^\s*#/.test(text)) continue;
    const f = pipeToShellIn(text, /\.ps1$/i.test(ctx.file.path) ? 'powershell' : 'sh');
    if (!f) continue;
    const subject = role === 'hook-script' ? 'This hook script runs' : 'This skill script runs';
    report(start + 1, 'block', `${subject} \`${f.snippet}\`, ${effect(f)}.`, role);
  }
}
