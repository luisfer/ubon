import { generateScorecard } from '../utils/scorecard';
import { ScanResult } from '../types';

describe('scorecard generation', () => {
  it('builds expected aggregates and posture score', () => {
    const results: ScanResult[] = [
      { type: 'error', category: 'security', message: 'a', severity: 'high', ruleId: 'SEC1', confidence: 0.9 },
      { type: 'warning', category: 'security', message: 'b', severity: 'medium', ruleId: 'SEC2', confidence: 0.8 },
      { type: 'warning', category: 'accessibility', message: 'c', severity: 'low', ruleId: 'A11Y1', confidence: 0.7 }
    ];

    const scorecard = generateScorecard(results);
    expect(scorecard.total).toBe(3);
    expect(scorecard.bySeverity).toEqual({ high: 1, medium: 1, low: 1 });
    expect(scorecard.byType).toEqual({ error: 1, warning: 2, info: 0 });
    expect(scorecard.byCategory.security).toBe(2);
    expect(scorecard.byCategory.accessibility).toBe(1);
    expect(scorecard.securityPosture).toBe(80); // 100 - 15 - 5
  });
});
