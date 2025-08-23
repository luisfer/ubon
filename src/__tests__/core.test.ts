import { UbonScan } from '../index';
import { toSarif } from '../utils/sarif';
import { ScanResult } from '../types';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('Ubon core', () => {
  const tmp = join(process.cwd(), '.tmp-core-tests');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('filters by confidence and enabled/disabled rules', () => {
    const s = new UbonScan(false, true);
    const results: ScanResult[] = [
      { type: 'warning', category: 'security', message: 'a', severity: 'low', ruleId: 'R1', confidence: 0.5 },
      { type: 'warning', category: 'security', message: 'b', severity: 'low', ruleId: 'R2', confidence: 0.9 },
      { type: 'warning', category: 'security', message: 'c', severity: 'low', ruleId: 'R3', confidence: 0.9 }
    ];
    // @ts-ignore private
    const cfiltered = (s as any).filterResults(results, { directory: tmp, minConfidence: 0.8 });
    expect(cfiltered.map((r: ScanResult) => r.ruleId)).toEqual(['R2', 'R3']);
    // @ts-ignore private
    const onlyR2 = (s as any).filterResults(results, { directory: tmp, enabledRules: ['R2'] });
    expect(onlyR2.map((r: ScanResult) => r.ruleId)).toEqual(['R2']);
    // @ts-ignore private
    const noR23 = (s as any).filterResults(results, { directory: tmp, disabledRules: ['R2','R3'] });
    expect(noR23.map((r: ScanResult) => r.ruleId)).toEqual(['R1']);
  });

  it('applies baseline suppressions', async () => {
    const s = new UbonScan(false, true);
    const findings = [
      { type: 'warning', category: 'security', message: 'm', file: 'a.ts', line: 1, severity: 'low', ruleId: 'R1', confidence: 0.9 },
      { type: 'warning', category: 'security', message: 'n', file: 'b.ts', line: 2, severity: 'low', ruleId: 'R2', confidence: 0.9 }
    ];
    // @ts-ignore private
    const withFp = findings.map((r: any) => ({ ...r, fingerprint: s.computeFingerprint(r) }));
    const baselinePath = join(tmp, '.ubon.baseline.json');
    const payload = { generatedAt: new Date().toISOString(), fingerprints: withFp.map((r: any) => r.fingerprint) };
    writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
    // @ts-ignore private
    const filtered = await (s as any).applyBaseline(withFp, { directory: tmp, baselinePath, useBaseline: true });
    expect(filtered).toHaveLength(0);
  });

  it('serializes SARIF with rules and results', () => {
    const results: ScanResult[] = [
      { type: 'error', category: 'security', message: 'x', file: 'a.ts', line: 1, severity: 'high', ruleId: 'R1', confidence: 0.9 },
      { type: 'warning', category: 'accessibility', message: 'y', file: 'b.tsx', line: 2, severity: 'medium', ruleId: 'R2', confidence: 0.8 }
    ];
    const sarif = toSarif(results, tmp);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('ubon');
    expect(sarif.runs[0].results.length).toBe(2);
    expect((sarif.runs[0].tool.driver.rules || []).length).toBe(2);
  });
});
