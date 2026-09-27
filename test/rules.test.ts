import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RULES } from '../src/rules/index.ts';
import { listFixtureCases, readExpectations, runFixture } from './support/rule-tester.ts';

/**
 * Every rule runs against its fixtures in fixtures/rules/<pack>/<name>/.
 * A fixture fails on any missing or extra finding.
 */

const cases = listFixtureCases();
const ENGINE_RULES = new Set(['integrity/invalid-suppression', 'integrity/unused-suppression']);

for (const fixture of cases) {
  test(`${fixture.rule} (${fixture.name})`, async () => {
    const result = await runFixture(fixture);
    assert.deepEqual(result.problems, [], `\n${result.problems.join('\n')}`);
  });
}

test('every file, project, and diff rule has fixtures', () => {
  const withFixtures = new Set(cases.map((c) => c.rule));
  const missing = RULES.filter((r) => r.meta.scope !== 'hook' && !ENGINE_RULES.has(r.meta.id) && !withFixtures.has(r.meta.id)).map((r) => r.meta.id);
  assert.deepEqual(missing, []);
});

test('block rules have at least 4 flagged cases and 5 safe cases', () => {
  const short: string[] = [];
  // Rules whose only check is a registry or OSV lookup cannot flag anything offline; test/deps.test.ts covers them with a stubbed network.
  const onlineOnly = (r: (typeof RULES)[number]) => Boolean(r.online) && !r.js && !r.text && !r.project && !r.diff;
  for (const rule of RULES.filter((r) => r.meta.level === 'block' && r.meta.scope !== 'hook' && !onlineOnly(r))) {
    let flagged = 0;
    let ok = 0;
    for (const c of cases.filter((x) => x.rule === rule.meta.id)) {
      const isDiff = existsSync(join(c.dir, 'after'));
      const e = readExpectations(isDiff ? join(c.dir, 'after') : c.dir, rule.meta.id);
      flagged += e.expected.length;
      ok += e.okCount;
      if (isDiff) ok += readExpectations(join(c.dir, 'before'), rule.meta.id).okCount;
    }
    if (flagged < 4 || ok < 5) short.push(`${rule.meta.id}: ${flagged} flagged, ${ok} safe`);
  }
  assert.deepEqual(short, []);
});
