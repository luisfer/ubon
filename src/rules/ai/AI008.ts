import { Rule } from '../types';

/**
 * AI008: Unbounded LLM call (no max_tokens, no input length validation).
 *
 * Combines two cost-amplification footguns:
 *   1. `max_tokens` / `maxOutputTokens` is unset → response can run to the
 *      provider hard limit.
 *   2. The user-supplied prompt is forwarded verbatim with no length check
 *      → attackers stuff in megabytes of context and rack up token bills.
 */
const rule: Rule = {
  meta: {
    id: 'AI008',
    category: 'security',
    severity: 'medium',
    message: 'LLM call without max_tokens / input length guard (cost-amplification risk)',
    fix: 'Set `max_tokens` (or `maxOutputTokens`) on every model call, and clamp untrusted input length before sending it to the model.',
    impact:
      'Unbounded calls turn a single abusive request into a multi-dollar one and are the cheapest way to grief an AI feature.'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']
  }
};

export default rule;
