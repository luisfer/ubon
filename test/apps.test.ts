import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { main } from '../src/cli/main.ts';
import type { Report } from '../src/core/types.ts';
import { expandFakeKeysInDir } from './support/fake-keys.ts';
import { commitAll, FIXTURES, initRepo, tempDir } from './support/fixtures.ts';
import { memoryIO } from './support/io.ts';

/**
 * Fixture apps (fixtures/apps/<name>/) are small, realistic projects with
 * planted problems; they are also the examples in the docs.
 *
 * - app/ is the project. `ubon check --all` must report exactly the findings
 *   in EXPECTED.json: rule, file, line, and level.
 * - fixed/ holds corrected versions of the files with problems. Applied on
 *   top of app/, the project must have no block findings, and only the
 *   warnings EXPECTED.json lists under "fixedWarnings".
 *
 * EXPECTED.json is reviewed by hand. When a rule change moves a finding,
 * check the new result against the code before you update the file.
 */

interface Expected {
  rule: string;
  file: string;
  line: number;
  level: 'block' | 'warn';
  note?: string;
}

interface ExpectedFile {
  findings: Expected[];
  fixedWarnings?: Expected[];
}

const APPS = join(FIXTURES, 'apps');
const apps = existsSync(APPS) ? readdirSync(APPS).filter((d) => existsSync(join(APPS, d, 'app'))).sort() : [];

async function checkAll(dir: string): Promise<Report> {
  const io = memoryIO(dir);
  const code = await main(['check', '--all', '--format', 'json'], io);
  assert.ok(code === 0 || code === 1, `ubon check exited with ${code}: ${io.err}`);
  return JSON.parse(io.out) as Report;
}

function project(app: string, withFixes: boolean): string {
  const dir = tempDir(`ubon-app-${app}-`);
  cpSync(join(APPS, app, 'app'), dir, { recursive: true });
  if (withFixes) cpSync(join(APPS, app, 'fixed'), dir, { recursive: true });
  expandFakeKeysInDir(dir);
  initRepo(dir);
  commitAll(dir, 'app');
  return dir;
}

const key = (f: { rule: string; file: string; line: number; level: string }) => `${f.level} ${f.rule} ${f.file}:${f.line}`;

describe('fixture apps', () => {
  test('there are fixture apps', () => {
    assert.ok(apps.length >= 7, `expected 7 fixture apps, found ${apps.length}`);
  });

  for (const app of apps) {
    describe(app, () => {
      // Read inside each test: an error while the suite registers does not fail the run.
      const readExpected = () => JSON.parse(readFileSync(join(APPS, app, 'EXPECTED.json'), 'utf8')) as ExpectedFile;

      test('reports exactly the planted problems', async () => {
        const expected = readExpected();
        const dir = project(app, false);
        try {
          const report = await checkAll(dir);
          const actual = report.findings.map((f) => key({ rule: f.rule, file: f.file, line: f.range.start.line, level: f.level })).sort();
          const wanted = expected.findings.map(key).sort();
          assert.deepEqual(actual, wanted, `findings differ from EXPECTED.json:\n${report.findings.map((f) => `  ${key({ rule: f.rule, file: f.file, line: f.range.start.line, level: f.level })}  ${f.message}`).join('\n')}`);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });

      test('the fixed twin has no block findings', async () => {
        const expected = readExpected();
        assert.ok(existsSync(join(APPS, app, 'fixed')), 'fixed/ is missing');
        const dir = project(app, true);
        try {
          const report = await checkAll(dir);
          const blocking = report.findings.filter((f) => f.level === 'block');
          assert.equal(blocking.length, 0, blocking.map((f) => `${f.rule} ${f.file}:${f.range.start.line} ${f.message}`).join('\n'));
          const warnings = report.findings.map((f) => key({ rule: f.rule, file: f.file, line: f.range.start.line, level: f.level })).sort();
          assert.deepEqual(warnings, (expected.fixedWarnings ?? []).map(key).sort(), 'warnings in fixed/ differ from EXPECTED.json fixedWarnings');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });
  }
});
