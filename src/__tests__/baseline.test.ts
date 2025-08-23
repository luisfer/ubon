import { UbonScan } from '../index';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('Baseline filtering', () => {
  const tmp = join(process.cwd(), '.tmp-baseline-tests');
  const baselinePath = join(tmp, '.ubon.baseline.json');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('writes and applies baseline', async () => {
    const s = new UbonScan(false, true);
    const findings = [
      { type: 'warning', category: 'security', message: 'm', file: 'a.ts', line: 1, severity: 'low', ruleId: 'R1', confidence: 0.9 },
      { type: 'warning', category: 'security', message: 'n', file: 'b.ts', line: 2, severity: 'low', ruleId: 'R2', confidence: 0.9 }
    ];
    // @ts-ignore private
    const withFp = findings.map((r: any) => ({ ...r, fingerprint: s.computeFingerprint(r) }));
    const payload = { generatedAt: new Date().toISOString(), fingerprints: withFp.map((r: any) => r.fingerprint) };
    writeFileSync(baselinePath, JSON.stringify(payload, null, 2));

    // All suppressed
    // @ts-ignore private
    const filteredAll = await (s as any).applyBaseline(withFp, { directory: tmp, baselinePath, useBaseline: true });
    expect(filteredAll).toHaveLength(0);

    // None suppressed when baseline disabled
    // @ts-ignore private
    const filteredNone = await (s as any).applyBaseline(withFp, { directory: tmp, baselinePath, useBaseline: false });
    expect(filteredNone).toHaveLength(2);
  });
});


