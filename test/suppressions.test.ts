import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/core/config.ts';
import { runCheck } from '../src/core/engine.ts';
import { ruleIds } from '../src/rules/index.ts';
import { fakeKey } from './support/fake-keys.ts';
import { commitAll, initRepo, tempDir, writeFiles } from './support/fixtures.ts';

function repo(): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': '{"name":"s","private":true}', 'src/a.ts': 'export const a = 1;\n' });
  commitAll(dir, 'base');
  return dir;
}

test('a suppression cannot hide the listing of new suppressions', async () => {
  const dir = repo();
  const key = fakeKey('openai-project', 300);
  writeFileSync(
    join(dir, 'src/a.ts'),
    `export const a = 1;\n// ubon-ignore secret/provider-key, integrity/new-suppression: user confirmed: a test key\nexport const k = '${key}';\n`,
  );
  const config = parseConfig({ suppressions: { agent: 'human-only' } }, new Set(ruleIds()));
  const { report } = await runCheck({ cwd: dir, mode: 'diff', base: 'HEAD', config, inSession: true, useBaseline: false });
  assert.equal(report.findings.some((f) => f.rule === 'secret/provider-key'), false, 'the key finding is suppressed');
  const listing = report.findings.filter((f) => f.rule === 'integrity/new-suppression');
  assert.equal(listing.length, 1, 'the new suppression is still listed');
  assert.equal(listing[0]?.level, 'block', 'and it blocks, because the policy is human-only in an agent session');
});
