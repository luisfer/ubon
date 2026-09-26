import { parseArgs } from 'node:util';
import { relative, resolve } from 'node:path';
import { repoRoot } from '../core/git.ts';
import { toPosix } from '../core/files.ts';
import { UsageError } from '../core/scope.ts';
import { buildMap, formatMapMarkdown, formatMapText } from '../map/index.ts';
import type { IO } from './io.ts';
import { EXIT } from './main.ts';

const HELP = `Usage: ubon map [folder] [--json | --markdown]

Lists the application's entry points (route handlers, Server Actions, form
actions, loaders, API routes, and tools that models can call) with the auth
calls, data access, network calls, model calls, and env variables each one
uses. It reports facts for a review; it does not decide which routes should
be public.
`;

export async function runMap(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: 'boolean' }, markdown: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const root = repoRoot(io.cwd) ?? io.cwd;
  let under: string | undefined;
  if (positionals[0]) {
    under = toPosix(relative(root, resolve(io.cwd, positionals[0])));
    if (under.startsWith('..')) throw new UsageError(`${positionals[0]} is outside the project (${root}).`);
    if (under === '' || under === '.') under = undefined;
  }
  const map = await buildMap({ cwd: root, ...(under ? { under } : {}) });
  if (values.json) io.stdout(`${JSON.stringify(map, null, 2)}\n`);
  else if (values.markdown) io.stdout(formatMapMarkdown(map));
  else io.stdout(formatMapText(map));
  return EXIT.ok;
}
