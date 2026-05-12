import { cpSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { UbonScan } from '../index';
import { applyFixes } from '../utils/fix';

interface ExpectedFinding {
  ruleId: string;
  file: string;
  severity: 'high' | 'medium' | 'low';
  type: 'error' | 'warning' | 'info';
  minConfidence: number;
  autofixable?: boolean;
}

interface FixtureManifest {
  fixtures: Array<{
    name: string;
    directory: string;
    expected: ExpectedFinding[];
  }>;
}

const manifestPath = join(process.cwd(), 'examples', 'validation-fixtures', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as FixtureManifest;

jest.setTimeout(20000);

function fixtureDirectory(fixture: FixtureManifest['fixtures'][number]): string {
  return resolve(process.cwd(), 'examples', 'validation-fixtures', fixture.directory);
}

describe('Ubon validation fixture benchmark', () => {
  it.each(manifest.fixtures)('catches expected faults with repair-grade metadata: $name', async (fixture) => {
    const scanner = new UbonScan(false, true, 'never', true);
    const results = await scanner.diagnose({
      directory: fixtureDirectory(fixture),
      fast: true,
      noResultCache: true,
      minConfidence: 0.5,
      useBaseline: false
    });

    for (const expected of fixture.expected) {
      const finding = results.find((result) =>
        result.ruleId === expected.ruleId &&
        result.file === expected.file
      );

      expect(finding).toBeTruthy();
      expect(finding?.type).toBe(expected.type);
      expect(finding?.severity).toBe(expected.severity);
      expect(finding?.confidence ?? 0).toBeGreaterThanOrEqual(expected.minConfidence);
      expect(finding?.line).toBeGreaterThan(0);
      expect(finding?.range?.startLine).toBe(finding?.line);
      expect(finding?.match).toBeTruthy();
      expect(finding?.fix).toBeTruthy();
      expect(finding?.confidenceReason).toBeTruthy();

      if (expected.autofixable) {
        expect(finding?.fixEdits?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('applies an autofix in a temp fixture copy and removes the target finding on rescan', async () => {
    const source = resolve(process.cwd(), 'examples', 'ai-harness-demo');
    const tempParent = mkdtempSync(join(tmpdir(), 'ubon-repair-loop-'));
    const tempFixture = join(tempParent, 'ai-harness-demo');
    cpSync(source, tempFixture, { recursive: true });

    try {
      const scanner = new UbonScan(false, true, 'never', true);
      const before = await scanner.diagnose({
        directory: tempFixture,
        fast: true,
        noResultCache: true,
        minConfidence: 0.7,
        useBaseline: false
      });
      const cc009 = before.find((result) => result.ruleId === 'CC009');
      expect(cc009?.fixEdits?.length ?? 0).toBeGreaterThan(0);

      const applied = applyFixes(before, tempFixture, false);
      expect(applied.appliedEditCount).toBeGreaterThan(0);
      expect(applied.changedFiles).toContain('.cursor/hooks.json');

      const after = await scanner.diagnose({
        directory: tempFixture,
        fast: true,
        noResultCache: true,
        minConfidence: 0.7,
        useBaseline: false
      });
      expect(after.some((result) => result.ruleId === 'CC009')).toBe(false);
    } finally {
      rmSync(tempParent, { recursive: true, force: true });
    }
  });
});
