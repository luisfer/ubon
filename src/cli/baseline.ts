import { parseArgs } from 'node:util';
import { BASELINE_FILE, baselineFrom, writeBaseline } from '../core/baseline.ts';
import { runCheck } from '../core/engine.ts';
import { repoRoot } from '../core/git.ts';
import type { IO } from './io.ts';
import { EXIT } from './main.ts';

const HELP = `Usage: ubon baseline

Runs a full check (like \`ubon check --all\`) and records every finding's rule,
file, and fingerprint in ${BASELINE_FILE}. Later checks leave those findings
out, so an existing project can adopt Ubon and see only new problems.
The file holds no code and no secrets. Commit it.
`;

export async function runBaseline(argv: string[], io: IO): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: true, options: { help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const root = repoRoot(io.cwd) ?? io.cwd;
  const { report } = await runCheck({ cwd: root, mode: 'all', useBaseline: false });
  const baseline = baselineFrom(report.findings);
  writeBaseline(root, baseline);
  const { block, warn } = report.summary;
  io.stdout(`ubon: recorded ${baseline.findings.length} findings (${block} blocking, ${warn} warnings) in ${BASELINE_FILE}.\n`);
  if (report.notChecked.length > 0) io.stdout(`Not checked: ${report.notChecked.join('; ')}.\n`);
  return EXIT.ok;
}
