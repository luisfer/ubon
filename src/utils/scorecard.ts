import { ScanResult } from '../types';

export interface Scorecard {
  total: number;
  bySeverity: {
    high: number;
    medium: number;
    low: number;
  };
  byType: {
    error: number;
    warning: number;
    info: number;
  };
  byCategory: Record<string, number>;
  securityPosture: number;
}

export function generateScorecard(results: ScanResult[]): Scorecard {
  const bySeverity = {
    high: results.filter((r) => r.severity === 'high').length,
    medium: results.filter((r) => r.severity === 'medium').length,
    low: results.filter((r) => r.severity === 'low').length
  };
  const byType = {
    error: results.filter((r) => r.type === 'error').length,
    warning: results.filter((r) => r.type === 'warning').length,
    info: results.filter((r) => r.type === 'info').length
  };
  const byCategory = results.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const securityResults = results.filter((r) => r.category === 'security');
  let securityPosture = 100;
  securityPosture -= securityResults.filter((r) => r.severity === 'high').length * 15;
  securityPosture -= securityResults.filter((r) => r.severity === 'medium').length * 5;
  securityPosture -= securityResults.filter((r) => r.severity === 'low').length;
  securityPosture = Math.max(0, securityPosture);

  return {
    total: results.length,
    bySeverity,
    byType,
    byCategory,
    securityPosture
  };
}
