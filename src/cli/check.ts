import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { levenshtein } from '../core/config.ts';
import { runCheck, selectorMatches } from '../core/engine.ts';
import { repoRoot } from '../core/git.ts';
import { loadSession } from '../core/session.ts';
import { UsageError } from '../core/scope.ts';
import type { ScopeMode } from '../core/types.ts';
import { toPosix } from '../core/files.ts';
import { FORMATS, type Format, formatReport } from '../report/index.ts';
import { ruleIds } from '../rules/index.ts';
import { type IO, detectAgentShell, sessionIdFromEnv } from './io.ts';
import { EXIT } from './main.ts';

const HELP = `Usage: ubon check [paths...] [options]

Checks what changed since the base (default), every file (--all), what is
staged (--staged), or the given paths.

Options:
  --all              Check every file, not only changes
  --base <ref>       Compare against this ref (default: merge base with the default branch)
  --staged           Check staged content, for pre-commit
  --format <name>    text, agent, json, sarif, or markdown
  --output <file>    Write the report to a file; repeatable, with the format taken
                     from each extension (.json, .sarif, .md) when there are several
  --summary <file>   Also append a Markdown summary to this file (for CI job summaries)
  --rule <id>        Only run this rule; accepts pack/*. Repeatable
  --online           Allow registry and OSV lookups for this run
  --quiet            Print findings only, no header or footer

Exit codes: 0 no blocking findings, 1 blocking findings, 2 usage or config error, 3 Ubon failed.
`;

export async function runCheckCommand(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      all: { type: 'boolean' },
      base: { type: 'string' },
      staged: { type: 'boolean' },
      format: { type: 'string' },
      output: { type: 'string', multiple: true },
      summary: { type: 'string' },
      rule: { type: 'string', multiple: true },
      online: { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  if (values.all && values.staged) throw new UsageError('--all and --staged cannot be combined.');
  if (values.staged && values.base) throw new UsageError('--staged always compares with HEAD; drop --base.');

  const outputs = values.output ?? [];
  const format = chooseFormat(values.format, outputs.length === 1 ? outputs[0] : undefined, io);
  const selectors = values.rule ?? [];
  validateSelectors(selectors);

  const root = repoRoot(io.cwd) ?? io.cwd;
  let paths = positionals.map((p) => toPosix(relative(root, isAbsolute(p) ? p : resolve(io.cwd, p))) || '.');
  for (const p of paths) if (p.startsWith('..')) throw new UsageError(`${p} is outside the project (${root}).`);
  // `ubon check .` at the root means every file.
  const wholeProject = paths.length > 0 && paths.every((p) => p === '.');
  if (wholeProject) paths = [];

  let mode: ScopeMode;
  let session = undefined;
  if (values.all || (wholeProject && !values.staged && !values.base)) mode = paths.length > 0 ? 'paths' : 'all';
  else if (values.staged) mode = 'staged';
  else if (values.base) mode = 'diff';
  else if (paths.length > 0) mode = 'paths';
  else {
    const id = sessionIdFromEnv(io.env);
    const record = id ? loadSession(root, id) : null;
    if (record) {
      mode = 'session';
      session = record;
    } else mode = 'diff';
  }

  const started = performance.now();
  const { report } = await runCheck({
    cwd: root,
    mode,
    ...(values.base ? { base: values.base } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    rules: selectors,
    online: values.online ?? false,
    ...(session ? { session, inSession: true } : {}),
  });
  const elapsedMs = performance.now() - started;
  if (outputs.length > 0) {
    for (const output of outputs) {
      const fileFormat = outputs.length === 1 ? format : formatForFile(output, values.format);
      const target = resolve(io.cwd, output);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, formatReport(report, fileFormat, { elapsedMs, quiet: values.quiet, color: false }));
    }
    const { block, warn } = report.summary;
    io.stdout(`ubon: ${block} blocking, ${warn} warnings; report written to ${outputs.join(', ')}\n`);
  } else {
    io.stdout(formatReport(report, format, { elapsedMs, quiet: values.quiet, color: io.isTTY }));
  }
  if (values.summary) {
    const target = resolve(io.cwd, values.summary);
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, formatReport(report, 'markdown'));
  }
  return report.summary.block > 0 ? EXIT.findings : EXIT.ok;
}

export function chooseFormat(explicit: string | undefined, output: string | undefined, io: IO): Format {
  if (explicit) {
    if (!(FORMATS as readonly string[]).includes(explicit)) throw new UsageError(`Unknown format "${explicit}". Use one of: ${FORMATS.join(', ')}.`);
    return explicit as Format;
  }
  const fromEnv = io.env.UBON_FORMAT;
  if (fromEnv && (FORMATS as readonly string[]).includes(fromEnv)) return fromEnv as Format;
  if (output) {
    if (/\.json$/i.test(output)) return 'json';
    if (/\.sarif(\.json)?$/i.test(output)) return 'sarif';
    if (/\.md$/i.test(output)) return 'markdown';
  }
  if (detectAgentShell(io.env)) return 'agent';
  return 'text';
}

function formatForFile(file: string, explicit: string | undefined): Format {
  if (/\.json$/i.test(file)) return 'json';
  if (/\.sarif(\.json)?$/i.test(file)) return 'sarif';
  if (/\.md$/i.test(file)) return 'markdown';
  if (explicit && (FORMATS as readonly string[]).includes(explicit)) return explicit as Format;
  return 'text';
}

export function validateSelectors(selectors: readonly string[]): void {
  const known = ruleIds();
  for (const s of selectors) {
    if ([...known].some((id) => selectorMatches(s, id))) continue;
    let best: string | null = null;
    let distance = 4;
    for (const id of known) {
      const d = levenshtein(s, id);
      if (d < distance) {
        best = id;
        distance = d;
      }
    }
    throw new UsageError(`Unknown rule "${s}".${best ? ` Did you mean "${best}"?` : ''} Run \`ubon rules\` for the list.`);
  }
}
