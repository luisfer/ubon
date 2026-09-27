#!/usr/bin/env node
// Records a real Claude Code session as a replayable fixture. Copies a fixture
// app into a temporary git repository, installs Ubon's hooks there with
// --record, runs `claude -p` with the prompt, and writes
// fixtures/sessions/claude/<scenario>.jsonl: a header line, then one line per
// hook call with the payload and Ubon's answer, both masked.
//
//   npm run build
//   node scripts/record-session.mjs <scenario> --app <fixture app> --prompt "<task>" [--allow "<tools>"] [--max-turns <n>]
//   node scripts/record-session.mjs --anonymize <recording>   rewrite an older recording in place
//
// It needs a working `claude` CLI and uses your Claude account. test/sessions.test.ts replays the result.
// The session ID and the transcript and scratchpad paths are replaced with fixed values (see anonymize()).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const root = join(import.meta.dirname, '..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { app: { type: 'string' }, prompt: { type: 'string' }, allow: { type: 'string' }, 'max-turns': { type: 'string' }, keep: { type: 'boolean' }, anonymize: { type: 'string' } },
});

/**
 * The session ID and the paths Claude Code reports for its transcript and
 * scratchpad identify the recording machine and mean nothing to a replay, so
 * they are replaced everywhere, commands included. The working copy's path
 * stays: the replay swaps it for its own.
 */
function anonymize(text, scenario) {
  const payload = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l).payload)
    .find((p) => p && typeof p.session_id === 'string');
  if (!payload) return text;
  const swaps = [
    [payload.scratchpad_dir, '/tmp/claude-scratchpad'],
    [payload.transcript_path, `~/.claude/projects/recorded/${scenario}.jsonl`],
    [payload.session_id, `recorded-${scenario}`],
  ];
  let out = text;
  for (const [from, to] of swaps) if (typeof from === 'string' && from) out = out.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
  return out;
}

if (values.anonymize) {
  const [headerLine, ...rest] = readFileSync(values.anonymize, 'utf8').split('\n');
  const header = JSON.parse(headerLine);
  writeFileSync(values.anonymize, `${JSON.stringify(header)}\n${anonymize(rest.join('\n'), header.scenario)}`);
  console.log(`anonymized ${values.anonymize}`);
  process.exit(0);
}

const [scenario] = positionals;
if (!scenario || !values.app || !values.prompt) {
  console.error('usage: node scripts/record-session.mjs <scenario> --app <fixture app> --prompt "<task>" [--allow "<tools>"] [--max-turns <n>]');
  process.exit(2);
}
const bin = join(root, 'dist', 'ubon.mjs');
if (!existsSync(bin)) throw new Error('dist/ubon.mjs is missing; run npm run build first');

const { HOOK_SPECS } = await import('../src/integrations/specs.ts');
const { expandFakeKeysInDir } = await import('../test/support/fake-keys.ts');

const dir = realpathSync(mkdtempSync(join(tmpdir(), `ubon-record-${scenario}-`)));
const recordFile = join(dir, '.git', 'ubon-record.jsonl');
const git = (...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });

cpSync(join(root, 'fixtures', 'apps', values.app, 'app'), dir, { recursive: true });
expandFakeKeysInDir(dir);
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=ubon', '-c', 'user.email=ubon@example.com', 'commit', '-q', '-m', 'start');

// Hooks go in .claude/settings.local.json, which git ignores, so they are not part of the session's changes.
const hooks = {};
for (const spec of HOOK_SPECS.claude) {
  const command = `node ${JSON.stringify(bin)} hook claude ${spec.event} --record ${JSON.stringify(recordFile)}`;
  hooks[spec.event] = [{ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [{ type: 'command', command, timeout: spec.timeout }] }];
}
mkdirSync(join(dir, '.claude'), { recursive: true });
writeFileSync(join(dir, '.claude', 'settings.local.json'), `${JSON.stringify({ hooks }, null, 2)}\n`);
writeFileSync(join(dir, '.git', 'info', 'exclude'), '.claude/settings.local.json\n');

const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(/\s/)[0];
const args = ['-p', values.prompt, '--permission-mode', 'acceptEdits', '--max-turns', values['max-turns'] ?? '12', '--output-format', 'json'];
if (values.allow) args.push('--allowedTools', values.allow);
const run = spawnSync('claude', args, { cwd: dir, encoding: 'utf8', timeout: 15 * 60 * 1000 });
let summary = '';
try {
  summary = JSON.parse(run.stdout).result ?? '';
} catch {
  summary = run.stdout;
}
console.log(`claude exited with ${run.status}. Final message:\n${summary}\n`);

if (!existsSync(recordFile)) throw new Error('no hook calls were recorded; check that the hooks ran');
const header = { scenario, agent: 'claude', agentVersion: version, app: values.app, cwd: dir, recorded: new Date().toISOString().slice(0, 10), note: values.prompt };
const out = join(root, 'fixtures', 'sessions', 'claude', `${scenario}.jsonl`);
mkdirSync(join(root, 'fixtures', 'sessions', 'claude'), { recursive: true });
writeFileSync(out, `${JSON.stringify(header)}\n${anonymize(readFileSync(recordFile, 'utf8'), scenario)}`);
console.log(`wrote ${out} (${readFileSync(recordFile, 'utf8').trim().split('\n').length} hook calls)`);
if (values.keep) console.log(`the session's working copy is in ${dir}`);
else rmSync(dir, { recursive: true, force: true });
