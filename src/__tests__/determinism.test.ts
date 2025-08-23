import { UbonScan } from '../index';
import { ScanResult } from '../types';

describe('Determinism', () => {
  it('sorts results stably and generates stable fingerprints', () => {
    const s = new UbonScan(false, true);
    const a: ScanResult = { type: 'warning', category: 'security', message: 'm', file: 'b.ts', line: 2, severity: 'low', ruleId: 'R2', confidence: 0.9, match: 'x' };
    const b: ScanResult = { type: 'error', category: 'security', message: 'n', file: 'a.ts', line: 1, severity: 'high', ruleId: 'R1', confidence: 0.9, match: 'y' };
    // @ts-ignore private
    const fa = s.computeFingerprint(a);
    // @ts-ignore private
    const fb = s.computeFingerprint(b);
    // Stable across invocations
    // @ts-ignore private
    expect(s.computeFingerprint(a)).toBe(fa);
    // @ts-ignore private
    expect(s.computeFingerprint(b)).toBe(fb);
    // Sorted: error first, then by category/file/line/ruleId
    // @ts-ignore private
    const sorted = s.sortResults([a, b]);
    expect(sorted[0].ruleId).toBe('R1');
  });
});


