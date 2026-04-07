import { collectFixEdits, parseFixLevel } from '../utils/fix';
import { ScanResult } from '../types';

function makeResult(ruleId: string, severity: 'high' | 'medium' | 'low', confidence: number): ScanResult {
  return {
    type: severity === 'high' ? 'error' : 'warning',
    category: 'security',
    message: `${ruleId} message`,
    file: 'src/app.ts',
    line: 1,
    severity,
    ruleId,
    confidence,
    fixEdits: [
      {
        file: 'src/app.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 10,
        replacement: 'fixed'
      }
    ]
  };
}

describe('fix safety levels', () => {
  const results: ScanResult[] = [
    makeResult('SAFE_MEDIUM_CONFIDENT', 'medium', 0.8),
    makeResult('SAFE_MEDIUM_LOW_CONF', 'medium', 0.79),
    makeResult('SAFE_HIGH_REJECTED', 'high', 0.85),
    makeResult('SAFE_HIGH_ALLOWED', 'high', 0.9),
    makeResult('REVIEW_ALLOWED', 'high', 0.75),
    makeResult('REVIEW_REJECTED', 'low', 0.69)
  ];

  it('safe level only keeps high-confidence fixes', () => {
    const safe = collectFixEdits(results, 'safe');
    const totalEdits = safe.reduce((sum, f) => sum + f.edits.length, 0);
    expect(totalEdits).toBe(2); // SAFE_MEDIUM_CONFIDENT + SAFE_HIGH_ALLOWED
  });

  it('review level expands to medium-confidence fixes', () => {
    const review = collectFixEdits(results, 'review');
    const totalEdits = review.reduce((sum, f) => sum + f.edits.length, 0);
    expect(totalEdits).toBe(5); // all except REVIEW_REJECTED
  });

  it('aggressive level includes every fix edit', () => {
    const aggressive = collectFixEdits(results, 'aggressive');
    const totalEdits = aggressive.reduce((sum, f) => sum + f.edits.length, 0);
    expect(totalEdits).toBe(6);
  });

  it('parses valid fix levels and rejects invalid ones', () => {
    expect(parseFixLevel()).toBe('safe');
    expect(parseFixLevel('safe')).toBe('safe');
    expect(parseFixLevel('review')).toBe('review');
    expect(parseFixLevel('aggressive')).toBe('aggressive');
    expect(() => parseFixLevel('unknown')).toThrow(/Unknown fix level/);
  });
});
