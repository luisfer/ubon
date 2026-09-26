#!/usr/bin/env node
// Checks the npm package: the file list (no sources, tests, or fixtures), the
// unpacked size (under 1 MB), and that the tarball installs with scripts
// disabled and runs: --version, check, and a hook with a recorded payload.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32', ...options });

execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
const [info] = JSON.parse(run(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root }));
const paths = info.files.map((f) => f.path).sort();
const problems = [];

const allowed = [/^dist\//, /^schema\/(config|report)\.json$/, /^skills\//, /^commands\/[\w-]+\.md$/, /^agents\/[\w-]+\.md$/, /^hooks\/hooks\.json$/, /^\.claude-plugin\/plugin\.json$/, /^(README|CHANGELOG)\.md$/, /^LICENSE$/, /^package\.json$/, /^llms\.txt$/, /^THIRD_PARTY_NOTICES\.md$/];
for (const p of paths) if (!allowed.some((re) => re.test(p))) problems.push(`unexpected file in the package: ${p}`);
for (const required of ['dist/ubon.mjs', 'dist/cli.mjs', 'dist/index.mjs', 'dist/index.d.ts', 'package.json', 'LICENSE', 'README.md', 'skills/ubon/SKILL.md', 'hooks/hooks.json', '.claude-plugin/plugin.json', 'schema/config.json', 'schema/report.json']) {
  if (!paths.includes(required)) problems.push(`missing from the package: ${required}`);
}
if (paths.some((p) => p.endsWith('.map'))) problems.push('source maps in the package');
const limit = 1024 * 1024;
if (info.unpackedSize > limit) problems.push(`unpacked size ${info.unpackedSize} bytes is over ${limit}`);
console.log(`package: ${paths.length} files, ${(info.unpackedSize / 1024).toFixed(0)} KB unpacked`);

// Install the real tarball in an empty project, with install scripts disabled, and run it.
const work = mkdtempSync(join(tmpdir(), 'ubon-pack-'));
try {
  const tarball = run(npm, ['pack', '--ignore-scripts', '--pack-destination', work], { cwd: root }).trim().split('\n').pop();
  writeFileSync(join(work, 'package.json'), '{"name":"pack-test","private":true}');
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(work, tarball)], { cwd: work });
  const bin = join(work, 'node_modules', 'ubon', 'dist', 'ubon.mjs');
  const version = run(process.execPath, [bin, '--version'], { cwd: work }).trim();
  const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (version !== expected) problems.push(`installed --version printed ${version}, expected ${expected}`);
  run('git', ['init', '-q'], { cwd: work });
  run(process.execPath, [bin, 'check', '--all', '--format', 'json'], { cwd: work });
  const payload = JSON.stringify({ session_id: 'pack', cwd: work, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  const hook = execFileSync(process.execPath, [bin, 'hook', 'claude', 'PreToolUse'], { cwd: work, input: payload, encoding: 'utf8' });
  if (hook.trim() !== '') problems.push(`hook for an allowed command printed output: ${hook.trim()}`);
  const types = readFileSync(join(work, 'node_modules', 'ubon', 'dist', 'index.d.ts'), 'utf8');
  if (!types.includes('export declare function check')) problems.push('dist/index.d.ts does not declare check()');
  const api = execFileSync(process.execPath, ['--input-type=module', '-e', "import { check, rules, version } from 'ubon'; const r = await check({ mode: 'all' }); console.log(r.schemaVersion, rules().length > 0, version)"], { cwd: work, encoding: 'utf8' }).trim();
  if (!api.startsWith('4.0 true')) problems.push(`programmatic API check printed: ${api}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

for (const p of problems) console.error(`pack: ${p}`);
console.log(problems.length === 0 ? 'pack: ok' : `pack: ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
