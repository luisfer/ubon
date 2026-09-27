#!/usr/bin/env node
// Measures precision on real code. Runs Ubon on the repositories pinned in
// corpus/repos.json and compares the findings with corpus/triage.jsonl, where
// a person marked each finding as a true or a false positive.
//
//   node scripts/corpus.mjs fetch            clone the pinned commits into the cache
//   node scripts/corpus.mjs run [--strict]   check every repository and list untriaged findings
//   node scripts/corpus.mjs report [--check] write docs/precision.md from the last run and the triage file
//
// The cache is corpus/.cache, or the directory in UBON_CORPUS_CACHE. `run`
// saves its results in the cache; `--strict` exits with 1 when a finding has
// no triage entry.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const cache = process.env.UBON_CORPUS_CACHE || join(root, 'corpus', '.cache');
const [command = 'run', ...flags] = process.argv.slice(2);
const { repos } = JSON.parse(readFileSync(join(root, 'corpus', 'repos.json'), 'utf8'));
const resultsFile = join(cache, 'results.json');
const triageFile = join(root, 'corpus', 'triage.jsonl');

const dirOf = (repo) => join(cache, repo.name.replace('/', '__'));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'advice.detachedHead=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

function fetchAll() {
  mkdirSync(cache, { recursive: true });
  for (const repo of repos) {
    const dir = dirOf(repo);
    if (existsSync(join(dir, '.git')) && git(dir, 'rev-parse', 'HEAD').trim() === repo.commit) {
      console.log(`corpus: ${repo.name} is at ${repo.commit.slice(0, 12)}`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, '.git'))) git(dir, 'init', '-q');
    git(dir, 'fetch', '-q', '--depth', '1', `https://github.com/${repo.name}.git`, repo.commit);
    git(dir, 'checkout', '-q', '--force', repo.commit);
    console.log(`corpus: fetched ${repo.name} at ${repo.commit.slice(0, 12)}`);
  }
}

function readTriage() {
  if (!existsSync(triageFile)) return [];
  return readFileSync(triageFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`corpus/triage.jsonl:${i + 1} is not valid JSON`);
      }
    });
}

/** Match findings to triage entries: by fingerprint, then by rule, file, and line. */
function match(findings, triage) {
  const byPrint = new Map(triage.map((t) => [`${t.repo}\u0000${t.fingerprint}`, t]));
  const byPlace = new Map(triage.map((t) => [`${t.repo}\u0000${t.rule}\u0000${t.file}\u0000${t.line}`, t]));
  const used = new Set();
  const rows = findings.map((f) => {
    const t = byPrint.get(`${f.repo}\u0000${f.fingerprint}`) ?? byPlace.get(`${f.repo}\u0000${f.rule}\u0000${f.file}\u0000${f.line}`);
    if (t) used.add(t);
    return { ...f, verdict: t?.verdict ?? null, note: t?.note ?? null };
  });
  const stale = triage.filter((t) => !used.has(t));
  return { rows, stale };
}

async function runAll() {
  const { runCheck } = await import('../src/core/engine.ts');
  const findings = [];
  const notChecked = {};
  for (const repo of repos) {
    const dir = dirOf(repo);
    if (!existsSync(dir)) throw new Error(`${repo.name} is not in the cache; run: node scripts/corpus.mjs fetch`);
    const started = performance.now();
    const { report } = await runCheck({ cwd: dir, mode: repo.paths ? 'paths' : 'all', ...(repo.paths ? { paths: repo.paths } : {}), useBaseline: false });
    const ms = Math.round(performance.now() - started);
    for (const f of report.findings) {
      findings.push({ repo: repo.name, rule: f.rule, level: f.level, file: f.file, line: f.range.start.line, fingerprint: f.fingerprint, message: f.message });
    }
    notChecked[repo.name] = report.notChecked;
    console.log(`corpus: ${repo.name}: ${report.summary.block} block, ${report.summary.warn} warn, ${report.scope.files} files in ${ms} ms`);
  }
  mkdirSync(cache, { recursive: true });
  writeFileSync(resultsFile, `${JSON.stringify({ findings, notChecked }, null, 1)}\n`);
  const { rows, stale } = match(findings, readTriage());
  const untriaged = rows.filter((r) => r.verdict === null);
  for (const u of untriaged) console.log(`untriaged: ${JSON.stringify({ repo: u.repo, rule: u.rule, level: u.level, file: u.file, line: u.line, fingerprint: u.fingerprint, message: u.message })}`);
  if (stale.length > 0) console.log(`corpus: ${stale.length} triage entries match no current finding (fixed rules or moved code)`);
  console.log(`corpus: ${findings.length} findings, ${untriaged.length} untriaged`);
  if (flags.includes('--strict') && untriaged.length > 0) process.exit(1);
}

async function report() {
  if (!existsSync(resultsFile)) throw new Error('no results yet; run: node scripts/corpus.mjs run');
  const { RULES } = await import('../src/rules/index.ts');
  const { findings } = JSON.parse(readFileSync(resultsFile, 'utf8'));
  const { rows } = match(findings, readTriage());
  const lines = [
    '<!-- Generated by scripts/corpus.mjs report from corpus/triage.jsonl. Do not edit. -->',
    '',
    '# Precision',
    '',
    `How often each rule is right on real code. Ubon checked ${repos.length} public repositories, pinned by commit in [corpus/repos.json](../corpus/repos.json), with \`ubon check --all\` (workflow repositories: \`.github/\` only). Every finding is marked as a true or a false positive in [corpus/triage.jsonl](../corpus/triage.jsonl), with a note that explains the verdict.`,
    '',
    'A rule may report `block` only if at least 95 percent of its block findings on the corpus are true positives. Rules that look at what a change did (most of `integrity`, `deps/typosquat`, `deps/install-script`) report nothing on a full check of a repository, and rules for commands run in agent hooks, so the corpus does not measure them; their fixtures and tests do. The same goes for any other rule with no findings here.',
    '',
    '| Repository | Kind | Block | Warn |',
    '| --- | --- | --- | --- |',
  ];
  for (const repo of repos) {
    const mine = rows.filter((r) => r.repo === repo.name);
    lines.push(`| [${repo.name}](https://github.com/${repo.name}/tree/${repo.commit}) | ${repo.kind} | ${mine.filter((r) => r.level === 'block').length} | ${mine.filter((r) => r.level === 'warn').length} |`);
  }
  lines.push('', '## By rule', '', 'Precision counts `block` findings only, because the gate applies to them; warnings are listed with their own counts.', '', '| Rule | Default level | Block findings | Block precision | Warnings | Warnings correct | Untriaged |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const rule of RULES) {
    const mine = rows.filter((r) => r.rule === rule.meta.id);
    if (mine.length === 0) continue;
    const blocks = mine.filter((r) => r.level === 'block');
    const warns = mine.filter((r) => r.level === 'warn');
    const tp = (list) => list.filter((r) => r.verdict === 'tp').length;
    const judged = (list) => list.filter((r) => r.verdict !== null).length;
    const precision = judged(blocks) > 0 ? `${Math.round((100 * tp(blocks)) / judged(blocks))}%` : 'n/a';
    const open = mine.filter((r) => r.verdict === null).length;
    lines.push(`| [${rule.meta.id}](rules/${rule.meta.id}.md) | ${rule.meta.level} | ${blocks.length} | ${precision} | ${warns.length} | ${tp(warns)} of ${judged(warns)} | ${open} |`);
  }
  const quiet = RULES.filter((r) => r.meta.scope !== 'hook' && !rows.some((row) => row.rule === r.meta.id)).map((r) => r.meta.id);
  lines.push('', `Rules with no findings on the corpus: ${quiet.length === 0 ? 'none' : quiet.map((id) => `\`${id}\``).join(', ')}.`);
  const fps = rows.filter((r) => r.verdict === 'fp');
  if (fps.length > 0) {
    lines.push('', '## False positives', '', 'Each one is a known limit of the rule.', '');
    for (const r of fps) lines.push(`- \`${r.rule}\` in ${r.repo}, \`${r.file}:${r.line}\`: ${r.note}`);
  }
  lines.push('');
  const text = lines.join('\n');
  const out = join(root, 'docs', 'precision.md');
  if (flags.includes('--check')) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (current !== text) {
      console.error('corpus: docs/precision.md is out of date; run: node scripts/corpus.mjs report');
      process.exit(1);
    }
    console.log('corpus: docs/precision.md is up to date');
    return;
  }
  writeFileSync(out, text);
  console.log('corpus: wrote docs/precision.md');
}

if (command === 'fetch') fetchAll();
else if (command === 'run') await runAll();
else if (command === 'report') await report();
else {
  console.error(`unknown command ${command}; use fetch, run, or report`);
  process.exit(2);
}
