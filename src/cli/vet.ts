import { parseArgs } from 'node:util';
import { loadConfig } from '../core/config.ts';
import { repoRoot } from '../core/git.ts';
import { UsageError } from '../core/scope.ts';
import { isAllowedPackage } from '../rules/deps/allow.ts';
import { isValidPackageName, parseInstallSpec } from '../rules/deps/spec.ts';
import type { PackageVerdict } from '../rules/deps/verdict.ts';
import { ruleIds } from '../rules/index.ts';
import type { IO } from './io.ts';
import { EXIT } from './main.ts';

const HELP = `Usage: ubon vet <package...> [options]

Checks packages before you install them: whether each one exists on the
registry, when it and the version that would be installed were published,
whether OSV has a malicious-package record for it, and whether its name
imitates a popular package. Lookups send package names and versions only.
Specs are written as for npm install: lodash, lodash@^4, @acme/ui@1.2.0.

Options:
  --offline    Skip registry and OSV lookups; check names only
  --json       Print the verdicts as JSON
  -h, --help   Show this help

Exit codes: 0 no package denied, 1 at least one package denied, 2 usage or config error.
`;

/** Lookups for vet may fetch large package documents; hooks pass their own, shorter budget. */
const CLI_TIMEOUT_MS = 30_000;

export async function runVet(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      offline: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const specs = positionals.map((p) => p.trim()).filter(Boolean);
  if (specs.length === 0) throw new UsageError('Name at least one package, for example `ubon vet lodash` or `ubon vet @acme/ui@1.2.0`.');

  const root = repoRoot(io.cwd) ?? io.cwd;
  const { config } = loadConfig(root, ruleIds());
  const online = !values.offline;
  const { vetPackages } = await import('../online/vet.ts');
  const verdicts = await vetPackages(specs, {
    root,
    online,
    minAgeDays: config.packages.minAgeDays,
    minReleaseAgeHours: config.packages.minReleaseAgeHours,
    allow: config.packages.allow,
    timeoutMs: CLI_TIMEOUT_MS,
  });

  if (values.json) io.stdout(`${JSON.stringify(verdicts, null, 2)}\n`);
  else io.stdout(formatVerdicts(verdicts, online, config.packages.allow));
  return verdicts.some((v) => v.decision === 'deny') ? EXIT.findings : EXIT.ok;
}

export function formatVerdicts(verdicts: readonly PackageVerdict[], online: boolean, allow: readonly string[] = []): string {
  const width = Math.min(40, Math.max(...verdicts.map((v) => v.spec.length)));
  const lines = verdicts.map((v) => {
    const rule = v.rule ? `${v.rule}  ` : '';
    return `${v.decision.padEnd(5)}  ${v.spec.padEnd(width)}  ${rule}${v.reason ?? ''}`;
  });
  const count = (d: PackageVerdict['decision']) => verdicts.filter((v) => v.decision === d).length;
  lines.push('', `ubon vet: ${count('deny')} denied, ${count('ask')} to confirm, ${count('allow')} allowed.`);
  const lookedUp = verdicts.filter((v) => needsLookup(v.spec, allow));
  if (!online && lookedUp.length > 0) {
    lines.push('Not checked: registry and OSV lookups (--offline), so existence, publish dates, and malicious-package records are unknown.');
  } else if (online) {
    const missed = lookedUp.filter((v) => v.checked === 'offline');
    if (missed.length > 0) lines.push(`Not checked on the registry: ${missed.map((v) => v.spec).join(', ')} (see the reasons above).`);
  }
  return `${lines.join('\n')}\n`;
}

/** Specs that vet looks up on the registry: valid registry names that are not on the allow list. */
function needsLookup(spec: string, allow: readonly string[]): boolean {
  const parsed = parseInstallSpec(spec);
  if (parsed.kind !== 'registry' && parsed.kind !== 'alias') return false;
  const name = parsed.name ?? '';
  return isValidPackageName(name) && !isAllowedPackage(name, allow);
}
