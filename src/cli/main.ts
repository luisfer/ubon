import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from '../core/config.ts';
import { BaselineError } from '../core/baseline.ts';
import { UsageError } from '../core/scope.ts';
import { VERSION } from '../version.ts';
import { type IO, processIO } from './io.ts';
import { v3CommandHint, v3OptionHint } from './v3.ts';

/**
 * `ubon` command-line entry. Exit codes are a contract:
 * 0 no blocking findings, 1 blocking findings, 2 usage or config error, 3 Ubon failed.
 */

export const EXIT = { ok: 0, findings: 1, usage: 2, failure: 3 } as const;

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  run(args: string[], io: IO): Promise<number>;
}

const COMMANDS: Array<[string, string, string, () => Promise<{ run(args: string[], io: IO): Promise<number> }>]> = [
  ['check', '[paths...]', 'Check what changed (default) or the given paths', () => import('./check.ts').then((m) => ({ run: m.runCheckCommand }))],
  ['init', '', 'Set up Ubon for this project and its agents (dry run unless --yes)', () => import('./init.ts').then((m) => ({ run: m.runInit }))],
  ['hook', '<agent> <event>', 'Handle one hook event from an agent; reads the event JSON on stdin', () => import('../hook/command.ts').then((m) => ({ run: m.runHook }))],
  ['vet', '<package...>', 'Check packages before installing them (registry lookup)', () => import('./vet.ts').then((m) => ({ run: m.runVet }))],
  ['map', '', 'List entry points, auth checks, data access, secrets, and model calls', () => import('./map.ts').then((m) => ({ run: m.runMap }))],
  ['explain', '<rule>', 'Show what a rule checks, why, and how to fix it, with tested examples', () => import('./rules.ts').then((m) => ({ run: m.runExplain }))],
  ['rules', '', 'List rules with their levels (--json for machines)', () => import('./rules.ts').then((m) => ({ run: m.runRules }))],
  ['baseline', '', 'Record current findings so --all audits only report new ones', () => import('./baseline.ts').then((m) => ({ run: m.runBaseline }))],
  ['mcp', '', 'Run the MCP server over stdio', () => import('../mcp/server.ts').then((m) => ({ run: m.runMcp }))],
  ['doctor', '', 'Check the installation, integrations, and recent hook activity', () => import('./doctor.ts').then((m) => ({ run: m.runDoctor }))],
];

export const COMMAND_NAMES = COMMANDS.map((c) => c[0]);

export function helpText(): string {
  const width = Math.max(...COMMANDS.map(([n, a]) => `${n} ${a}`.trim().length));
  const lines = COMMANDS.map(([name, args, summary]) => `  ubon ${`${name} ${args}`.trim().padEnd(width)}  ${summary}`);
  return [
    `ubon ${VERSION}: checks the work of coding agents`,
    '',
    'Usage:',
    ...lines,
    '',
    'Run `ubon <command> --help` for the options of a command.',
    'Docs: https://github.com/luisfer/ubon#readme',
    '',
  ].join('\n');
}

export async function main(argv: string[], io: IO = processIO()): Promise<number> {
  const [first, ...rest] = argv;
  if (first === '--version' || first === '-v' || first === 'version') {
    io.stdout(`${VERSION}\n`);
    return EXIT.ok;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    io.stdout(helpText());
    return EXIT.ok;
  }
  let name = 'check';
  let args = argv;
  if (first !== undefined && !first.startsWith('-')) {
    const known = COMMANDS.find((c) => c[0] === first);
    if (known) {
      name = first;
      args = rest;
    } else {
      // `ubon scan` and friends: a Ubon 3 command, unless a path with that name exists.
      const hint = v3CommandHint(first);
      if (hint && !existsSync(resolve(io.cwd, first))) {
        io.stderr(`ubon: ${hint}\n`);
        return EXIT.usage;
      }
    }
  }
  const command = COMMANDS.find((c) => c[0] === name);
  if (!command) {
    io.stderr(`ubon: unknown command "${first}". Run \`ubon --help\`.\n`);
    return EXIT.usage;
  }
  try {
    const loaded = await command[3]();
    return await loaded.run(args, io);
  } catch (error) {
    return reportError(error, io);
  }
}

export function reportError(error: unknown, io: IO): number {
  if (error instanceof ConfigError || error instanceof UsageError || error instanceof BaselineError || isParseArgsError(error)) {
    const message = (error as Error).message;
    const option = /^Unknown option '([^']+)'/.exec(message)?.[1];
    const hint = option ? v3OptionHint(option) : null;
    if (option) io.stderr(`ubon: unknown option ${option}. ${hint ?? 'Run `ubon <command> --help` for the options of a command.'}\n`);
    else io.stderr(`ubon: ${message}\n`);
    return EXIT.usage;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(`ubon: internal error: ${message}\n`);
  if (process.env.UBON_DEBUG && error instanceof Error) io.stderr(`${error.stack ?? ''}\n`);
  io.stderr('Please report this at https://github.com/luisfer/ubon/issues with the command you ran.\n');
  return EXIT.failure;
}

function isParseArgsError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS');
}
