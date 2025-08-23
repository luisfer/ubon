import { UbonScan } from '../index';
import { ScanResult } from '../types';

describe('Configuration filtering', () => {
  it('filters by minConfidence', async () => {
    const scanner = new UbonScan(false, true);
    const results: ScanResult[] = [
      { type: 'warning', category: 'security', message: 'a', severity: 'low', ruleId: 'X1', confidence: 0.5 },
      { type: 'warning', category: 'security', message: 'b', severity: 'low', ruleId: 'X2', confidence: 0.9 }
    ];

    // @ts-ignore access private
    const filtered = (scanner as any).filterResults(results, { directory: '.', minConfidence: 0.8 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].ruleId).toBe('X2');
  });

  it('filters by enabledRules and disabledRules', async () => {
    const scanner = new UbonScan(false, true);
    const results: ScanResult[] = [
      { type: 'warning', category: 'security', message: 'a', severity: 'low', ruleId: 'A', confidence: 0.9 },
      { type: 'warning', category: 'security', message: 'b', severity: 'low', ruleId: 'B', confidence: 0.9 },
      { type: 'warning', category: 'security', message: 'c', severity: 'low', ruleId: 'C', confidence: 0.9 }
    ];

    // @ts-ignore access private
    const onlyB = (scanner as any).filterResults(results, { directory: '.', enabledRules: ['B'] });
    expect(onlyB.map((r: ScanResult) => r.ruleId)).toEqual(['B']);

    // @ts-ignore access private
    const noBC = (scanner as any).filterResults(results, { directory: '.', disabledRules: ['B', 'C'] });
    expect(noBC.map((r: ScanResult) => r.ruleId)).toEqual(['A']);
  });
});


