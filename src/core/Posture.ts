import { ScanResult } from '../types';

export interface PostureScore {
  score: number;
  summary: string;
}

/**
 * Compute a 0–100 "security posture" score from scan results.
 *
 * Deductions are intentionally coarse (high=15, medium=5, low=1) so the score
 * tracks "how scary is the worst thing we found" rather than absolute count.
 * A repo with one critical SQL-injection rule should score lower than one
 * with 50 minor a11y nits.
 */
export function calculateSecurityPosture(results: ScanResult[]): PostureScore {
  let score = 100;

  const securityResults = results.filter((r) => r.category === 'security');
  const high = securityResults.filter((r) => r.severity === 'high').length;
  const medium = securityResults.filter((r) => r.severity === 'medium').length;
  const low = securityResults.filter((r) => r.severity === 'low').length;

  score -= high * 15;
  score -= medium * 5;
  score -= low * 1;
  score = Math.max(0, score);

  let summary: string;
  if (score >= 90) summary = 'Excellent! Your codebase has strong security practices.';
  else if (score >= 70) summary = 'Good security posture with some areas for improvement.';
  else if (score >= 50) summary = 'Moderate risk. Address high-severity issues first.';
  else if (score >= 30) summary = 'Significant security concerns. Immediate attention needed.';
  else summary = 'Critical security issues detected. Do not deploy until resolved.';

  return { score, summary };
}
