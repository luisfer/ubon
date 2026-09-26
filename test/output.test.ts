import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { runCheck } from '../src/core/engine.ts';
import { FORMATS, formatReport } from '../src/report/index.ts';
import { FAKE_KEY_GENERATORS, fakeKey } from './support/fake-keys.ts';
import { REPO_ROOT, commitAll, initRepo, tempDir, writeFiles } from './support/fixtures.ts';
import { validate } from './support/schema.ts';

const ENTRY = join(REPO_ROOT, 'test', 'support', 'ubon.ts');

function cli(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [ENTRY, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', CODEX_THREAD_ID: '', GEMINI_CLI: '', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function repoWith(files: Record<string, string>): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': '{"name":"out","private":true}', 'README.md': '# out\n' });
  commitAll(dir);
  writeFiles(dir, files);
  return dir;
}

describe('output contracts', () => {
  test('JSON output matches schema/report.json', async () => {
    const dir = repoWith({ 'src/a.ts': `export const k = '${fakeKey('stripe-live', 3)}';\n` });
    const { report } = await runCheck({ cwd: dir });
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'schema', 'report.json'), 'utf8'));
    assert.deepEqual(validate(schema, JSON.parse(formatReport(report, 'json'))), []);
    assert.equal(report.summary.block, 1);
  });

  test('SARIF has the structure code scanning needs', async () => {
    const dir = repoWith({ 'src/a.ts': `export const k = '${fakeKey('github-classic', 3)}';\n` });
    const { report } = await runCheck({ cwd: dir });
    const sarif = JSON.parse(formatReport(report, 'sarif'));
    assert.equal(sarif.version, '2.1.0');
    const run = sarif.runs[0];
    assert.equal(run.tool.driver.name, 'ubon');
    const result = run.results[0];
    assert.equal(result.ruleId, 'secret/provider-key');
    assert.equal(run.tool.driver.rules[result.ruleIndex].id, 'secret/provider-key');
    assert.equal(result.level, 'error');
    assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, 'src/a.ts');
    assert.match(result.partialFingerprints['ubon/v1'], /^[0-9a-f]{16}$/);
    assert.ok(run.tool.driver.rules.every((r: { properties: { tags: string[] } }) => Array.isArray(r.properties.tags)));
  });

  test('no output format ever contains a raw key (every provider format)', async () => {
    const files: Record<string, string> = {};
    const keys: string[] = [];
    for (const id of Object.keys(FAKE_KEY_GENERATORS)) {
      if (id === 'db-password' || id === 'high-entropy' || id === 'supabase-anon-jwt') continue;
      const key = fakeKey(id, 9);
      keys.push(id === 'aws-secret-key' ? key.split(' = ')[1] as string : key);
      files[`src/keys/${id}.ts`] = `export const value = ${JSON.stringify(key)};\n// ${key}\n`;
    }
    const dir = repoWith(files);
    const { report } = await runCheck({ cwd: dir });
    assert.ok(report.findings.length >= keys.length - 2, `expected findings for most formats, got ${report.findings.length}`);
    for (const format of FORMATS) {
      const text = formatReport(report, format);
      for (const key of keys) {
        // Masked values keep the documented prefix and the last four characters; nothing in between may appear.
        const secretPart = key.slice(-20, -4);
        assert.ok(!text.includes(key) && !text.includes(secretPart), `${format} output leaks a key (${key.slice(0, 8)}...)`);
      }
    }
  });
});

describe('exit codes', () => {
  test('0 without blocking findings, 1 with one', () => {
    const clean = repoWith({ 'src/ok.ts': 'export const ok = 1;\n' });
    assert.equal(cli(clean, ['check']).code, 0);
    const dirty = repoWith({ 'src/bad.ts': `export const k = '${fakeKey('anthropic', 4)}';\n` });
    const r = cli(dirty, ['check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /block {2}secret\/provider-key {2}src\/bad\.ts:1/);
  });

  test('2 for usage and config errors, with the key or flag named', () => {
    const dir = repoWith({});
    const flag = cli(dir, ['check', '--nope']);
    assert.equal(flag.code, 2);
    assert.match(flag.err, /--nope/);
    writeFileSync(join(dir, 'ubon.json'), JSON.stringify({ rules: { 'secret/provider-kee': 'off' } }));
    const config = cli(dir, ['check']);
    assert.equal(config.code, 2);
    assert.match(config.err, /Did you mean "secret\/provider-key"/);
    writeFileSync(join(dir, 'ubon.json'), JSON.stringify({ rulez: {} }));
    assert.match(cli(dir, ['check']).err, /Unknown key "rulez"/);
  });

  test('--rule filters, --format json, --output, and --summary', () => {
    const dir = repoWith({ 'src/bad.ts': `export const k = '${fakeKey('anthropic', 5)}';\n` });
    const only = cli(dir, ['check', '--rule', 'secret/db-url-password', '--rule', 'secret/public-env-name', '--format', 'json']);
    assert.equal(only.code, 0);
    assert.equal(JSON.parse(only.out).findings.length, 0);
    const out = cli(dir, ['check', '--output', 'r.sarif', '--summary', 'summary.md']);
    assert.equal(out.code, 1);
    assert.match(out.out, /report written to r\.sarif/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'r.sarif'), 'utf8')).version, '2.1.0');
    assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /### Ubon: 1 blocking/);
  });

  test('the agent format is chosen inside an agent shell', () => {
    const dir = repoWith({ 'src/bad.ts': `export const k = '${fakeKey('anthropic', 6)}';\n` });
    const r = cli(dir, ['check'], { CLAUDECODE: '1' });
    assert.match(r.out, /^ubon: 1 blocking in 1 changed file/);
    assert.match(r.out, /^BLOCK secret\/provider-key src\/bad\.ts:1 /m);
  });

  test('--version and --help', () => {
    const dir = repoWith({});
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
    assert.equal(cli(dir, ['--version']).out.trim(), pkg.version);
    assert.match(cli(dir, ['--help']).out, /ubon hook <agent> <event>/);
  });
});
