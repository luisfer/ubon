import { calculateSecurityPosture } from '../core/Posture';
import { ScanResult } from '../types';

const finding = (severity: 'high' | 'medium' | 'low', category: string = 'security'): ScanResult =>
  ({
    type: 'error',
    category,
    severity,
    message: 'm',
    ruleId: 'X',
    confidence: 0.9
  } as ScanResult);

describe('calculateSecurityPosture', () => {
  it('returns 100 + excellent for empty input', () => {
    const out = calculateSecurityPosture([]);
    expect(out.score).toBe(100);
    expect(out.summary).toMatch(/Excellent/);
  });

  it('only deducts for security category', () => {
    const out = calculateSecurityPosture([finding('high', 'accessibility')]);
    expect(out.score).toBe(100);
  });

  it('deducts 15 per high-severity security finding', () => {
    const out = calculateSecurityPosture([finding('high'), finding('high')]);
    expect(out.score).toBe(70);
    expect(out.summary).toMatch(/Good/);
  });

  it('deducts 5 per medium and 1 per low', () => {
    const out = calculateSecurityPosture([
      finding('medium'),
      finding('medium'),
      finding('low'),
      finding('low'),
      finding('low')
    ]);
    expect(out.score).toBe(87);
  });

  it('clamps to 0 and reports critical summary', () => {
    const arr = Array.from({ length: 10 }, () => finding('high'));
    const out = calculateSecurityPosture(arr);
    expect(out.score).toBe(0);
    expect(out.summary).toMatch(/Critical/);
  });

  it('reports moderate summary in 50–69 range', () => {
    const arr = [finding('high'), finding('high'), finding('high')];
    const out = calculateSecurityPosture(arr);
    expect(out.score).toBe(55);
    expect(out.summary).toMatch(/Moderate/);
  });

  it('reports significant summary in 30–49 range', () => {
    const arr = [finding('high'), finding('high'), finding('high'), finding('high')];
    const out = calculateSecurityPosture(arr);
    expect(out.score).toBe(40);
    expect(out.summary).toMatch(/Significant/);
  });
});
