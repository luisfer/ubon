/**
 * Ubon 3 commands and options. People upgrading get a pointer to the Ubon 4
 * equivalent instead of a generic usage error.
 */

export const UPGRADE_URL = 'https://github.com/luisfer/ubon/blob/main/docs/upgrade.md';

const COMMANDS: Record<string, string> = {
  scan: 'use `ubon check --all`',
  changed: 'use `ubon check`, which checks the changes since the base branch',
  verify: 'use `ubon check`',
  review: 'use `ubon check`, or the /ubon:review command in Claude Code',
  agent: 'use `ubon init`',
  hooks: 'use `ubon init`',
  'install-hooks': 'use `ubon init --git-hooks`',
  install: 'use `ubon init`',
  cache: 'Ubon 4 keeps no cache in the project; delete .ubon/results-cache.json',
  completion: 'shell completion was removed',
  guide: 'see `ubon --help` and `ubon explain <rule>`',
  lsp: 'the language server was removed',
  list: 'use `ubon rules`',
};

const OPTIONS: Record<string, string> = {
  '--json': 'use `--format json`',
  '--ndjson': 'use `--format json`',
  '--sarif': 'use `--format sarif`, or `--output <file>.sarif`',
  '--fast': 'remove it; checks are local unless you pass --online',
  '--fail-on': 'remove it; the exit code is 1 only for block findings, and ubon.json sets rule levels',
  '--profile': 'remove it; frameworks are detected per file',
  '--preset': 'remove it',
  '--mode': 'remove it',
  '--detailed': 'remove it',
  '--changed-files': 'pass the paths as arguments: `ubon check <paths...>`',
  '--git-changed-since': 'use `--base <ref>`',
  '--since': 'use `--base <ref>`',
  '--base-sha': 'use `--base <ref>`',
  '--directory': 'run Ubon in that directory, or pass paths as arguments',
  '-d': 'run Ubon in that directory, or pass paths as arguments',
  '--min-confidence': 'remove it; every rule reports block or warn',
  '--min-severity': 'remove it; every rule reports block or warn',
  '--severity': 'remove it; every rule reports block or warn',
  '--focus-critical': 'remove it',
  '--focus-security': 'remove it',
  '--focus-new': 'remove it; `ubon check` reports only what the change introduced',
  '--enable-rule': 'use `--rule <id>` for one run, or set levels in ubon.json',
  '--disable-rule': 'set the rule to "off" in ubon.json',
  '--baseline': 'run `ubon baseline`; the file is .ubon/baseline.json',
  '--update-baseline': 'run `ubon baseline`',
  '--no-baseline': 'remove it',
  '--no-cache': 'remove it; Ubon 4 keeps no cache',
  '--no-result-cache': 'remove it; Ubon 4 keeps no cache',
  '--clear-cache': 'remove it; Ubon 4 keeps no cache',
  '--interactive': 'remove it',
  '--watch': 'remove it; the agent hooks from `ubon init` check each edit',
  '--apply-fixes': 'remove it; Ubon does not edit code',
  '--preview-fixes': 'remove it; Ubon does not edit code',
  '--fix-dry-run': 'remove it; Ubon does not edit code',
  '--create-pr': 'remove it',
  '--pr-comment': 'use the GitHub Action with summary: true',
  '--ai-friendly': 'remove it; the output format is chosen for agents automatically, or use `--format agent`',
  '--show-context': 'remove it',
  '--show-confidence': 'remove it',
  '--show-suppressed': 'remove it; suppressed findings are counted in the summary',
  '--ignore-suppressed': 'remove it',
  '--group-by': 'remove it',
  '--max-issues': 'remove it',
  '--crawl-start-url': 'the crawler was removed',
  '--allow-config-js': 'remove it; Ubon 4 reads only ubon.json',
  '--write': 'use `--yes` with `ubon init`',
  '--dry-run': 'remove it; `ubon init` is a dry run unless you pass --yes',
};

/** A hint for a Ubon 3 command name, or null. */
export function v3CommandHint(name: string): string | null {
  const hint = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  return hint ? `\`${name}\` is a Ubon 3 command: ${hint}. Upgrade notes: ${UPGRADE_URL}` : null;
}

/** A hint for an unknown option that Ubon 3 had, or null. */
export function v3OptionHint(option: string): string | null {
  const name = option.split('=')[0] ?? option;
  const hint = Object.hasOwn(OPTIONS, name) ? OPTIONS[name] : undefined;
  return hint ? `${name} is a Ubon 3 option: ${hint}. Upgrade notes: ${UPGRADE_URL}` : null;
}
