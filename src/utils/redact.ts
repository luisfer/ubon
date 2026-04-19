/**
 * Centralized redaction for secret-like values that may appear in match
 * snippets, log lines, or rendered output.
 *
 * The goal is _defense in depth_: a finding that says "we found a Stripe key
 * here" should never include the actual key in JSON / SARIF / Markdown output
 * a CI system might forward to Slack, GitHub Actions logs, or PR comments.
 *
 * Detection list is intentionally conservative; we only mask values whose
 * structure is unambiguous. Generic "looks high-entropy" strings are left as
 * the rule's `match` so reviewers still have actionable evidence.
 */

interface MaskRule {
  pattern: RegExp;
  replacement: string;
}

const MASKS: MaskRule[] = [
  { pattern: /sk-[A-Za-z0-9_-]{8,}/g, replacement: 'sk-********' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-ant-********' },
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-proj-********' },
  { pattern: /eyJ[A-Za-z0-9._-]{20,}/g, replacement: 'eyJ********' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA****************' },
  { pattern: /ASIA[0-9A-Z]{16}/g, replacement: 'ASIA****************' },
  { pattern: /AIza[0-9A-Za-z_\-]{35}/g, replacement: 'AIza***********************************' },
  { pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: 'ghp_************************************' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: 'github_pat_********' },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: 'xox*-********' },
  { pattern: /sk_live_[A-Za-z0-9]{16,}/g, replacement: 'sk_live_********' },
  { pattern: /pk_live_[A-Za-z0-9]{16,}/g, replacement: 'pk_live_********' },
  { pattern: /rk_live_[A-Za-z0-9]{16,}/g, replacement: 'rk_live_********' },
];

export function redact(value?: string): string | undefined {
  if (!value) return value;
  let out = value;
  for (const rule of MASKS) {
    if (rule.pattern.test(out)) {
      // pattern has the global flag — clone with new RegExp to reset lastIndex
      out = out.replace(new RegExp(rule.pattern.source, rule.pattern.flags), rule.replacement);
    }
  }
  return out;
}
