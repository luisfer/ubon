import { parseArgs } from 'node:util';
import { configuredLevel, levenshtein, loadConfig } from '../core/config.ts';
import { repoRoot } from '../core/git.ts';
import { UsageError } from '../core/scope.ts';
import { EXAMPLES } from '../data/examples.ts';
import { RULES, ruleById, ruleIds } from '../rules/index.ts';
import { docsUrl } from '../rules/types.ts';
import type { IO } from './io.ts';
import { EXIT } from './main.ts';

const RULES_HELP = `Usage: ubon rules [--json]

Lists every rule with its default level, the level set in ubon.json, and its scope.
`;

export async function runRules(argv: string[], io: IO): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: true, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    io.stdout(RULES_HELP);
    return EXIT.ok;
  }
  const root = repoRoot(io.cwd) ?? io.cwd;
  const { config } = loadConfig(root, ruleIds());
  const rows = RULES.map((r) => ({
    id: r.meta.id,
    level: configuredLevel(config, r.meta.id) ?? r.meta.level,
    defaultLevel: r.meta.level,
    scope: r.meta.scope,
    title: r.meta.title,
    summary: r.meta.summary,
    docs: docsUrl(r.meta.id),
  }));
  if (values.json) {
    io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
    return EXIT.ok;
  }
  const idWidth = Math.max(...rows.map((r) => r.id.length));
  const lines = rows.map((r) => {
    const level = r.level === r.defaultLevel ? r.level : `${r.level} (default ${r.defaultLevel})`;
    return `${r.id.padEnd(idWidth)}  ${level.padEnd(5)}  ${r.scope.padEnd(7)}  ${r.title}`;
  });
  io.stdout(`${lines.join('\n')}\n\n${rows.length} rules. Run \`ubon explain <rule>\` for details.\n`);
  return EXIT.ok;
}

const EXPLAIN_HELP = `Usage: ubon explain <rule> [--json]

Shows what a rule checks, why it matters, how to fix a finding, and examples
taken from the rule's test fixtures.
`;

export async function runExplain(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    io.stdout(EXPLAIN_HELP);
    return EXIT.ok;
  }
  const id = positionals[0];
  if (!id) throw new UsageError('Name a rule, for example `ubon explain web/ssrf`. Run `ubon rules` for the list.');
  const rule = ruleById(id);
  if (!rule) {
    let best: string | null = null;
    let distance = 5;
    for (const known of ruleIds()) {
      const d = levenshtein(id, known);
      if (d < distance) {
        best = known;
        distance = d;
      }
    }
    throw new UsageError(`Unknown rule "${id}".${best ? ` Did you mean "${best}"?` : ''}`);
  }
  const examples = EXAMPLES[id] ?? { flagged: [], safe: [] };
  if (values.json) {
    io.stdout(`${JSON.stringify({ ...rule.meta, docs: docsUrl(id), examples }, null, 2)}\n`);
    return EXIT.ok;
  }
  const m = rule.meta;
  const out: string[] = [];
  out.push(`${m.id}: ${m.title}`);
  out.push(`Level: ${m.level}. Scope: ${m.scope}.${m.levels ? ` ${m.levels}` : ''}`);
  out.push('');
  out.push(`What it catches: ${m.summary}`);
  out.push('');
  out.push(`Why it matters: ${m.why}`);
  out.push('');
  out.push(`Fix: ${m.fix}`);
  if (examples.flagged.length > 0) {
    out.push('');
    out.push('Flagged:');
    for (const e of examples.flagged) out.push(`  ${e.file}: ${e.code}`);
  }
  if (examples.safe.length > 0) {
    out.push('');
    out.push('Not flagged:');
    for (const e of examples.safe) out.push(`  ${e.file}: ${e.code}${e.note ? `  (${e.note})` : ''}`);
  }
  out.push('');
  out.push(`To suppress one finding: // ubon-ignore ${m.id}: <who decided>: <evidence>`);
  const refs = [...(m.cwe ?? []), ...(m.owasp ?? [])];
  if (refs.length > 0) out.push(`References: ${refs.join(', ')}`);
  out.push(`Docs: ${docsUrl(m.id)}`);
  io.stdout(`${out.join('\n')}\n`);
  return EXIT.ok;
}
