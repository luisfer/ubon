import { Rule } from '../types';

/**
 * AI001: LLM provider API key hardcoded.
 *
 * Catches OpenAI, Anthropic, Google AI Studio / Gemini, Cohere, Mistral,
 * Groq, Together, Perplexity and Replicate keys when they appear inline
 * in source code or `.env` files (which is fine if `.env` is gitignored,
 * but ENV001/ENV002 cover that orthogonally).
 *
 * Why a dedicated rule (vs SEC001/SEC014): AI providers ship with their own
 * key prefixes, fast key-rotation flows, and free-tier abuse vectors that
 * deserve a focused fingerprint. A leaked AI key burns budget within
 * minutes once it hits the wild.
 */
const rule: Rule = {
  meta: {
    id: 'AI001',
    category: 'security',
    severity: 'high',
    message: 'LLM provider API key hardcoded',
    fix: 'Move the key to a server-only env var and rotate the leaked one immediately.',
    impact:
      'Leaked LLM keys are weaponised for crypto mining and abuse within minutes; quotas and bills can spike before you notice.',
    helpUri: 'https://platform.openai.com/docs/guides/production-best-practices/api-keys'
  },
  impl: {
    patterns: [
      {
        ruleId: 'AI001',
        confidence: 0.95,
        pattern: /(['"`])sk-(?:proj-|svcacct-|ant-|or-)[A-Za-z0-9_\-]{16,}\1/g,
        message: 'OpenAI/Anthropic-style API key hardcoded',
        severity: 'high',
        fix: 'Move key to a server-only env var; rotate the exposed value.'
      },
      {
        ruleId: 'AI001',
        confidence: 0.9,
        pattern: /(['"`])(?:sk-ant-api03-|sk-or-v1-)[A-Za-z0-9_\-]{20,}\1/g,
        message: 'Anthropic / OpenRouter API key hardcoded',
        severity: 'high',
        fix: 'Move key to env var and rotate the exposed value.'
      },
      {
        ruleId: 'AI001',
        confidence: 0.85,
        pattern: /(['"`])AIza[0-9A-Za-z_\-]{35}\1/g,
        message: 'Google AI / Gemini API key hardcoded',
        severity: 'high',
        fix: 'Move key to env var and rotate it via Google Cloud console.'
      },
      {
        ruleId: 'AI001',
        confidence: 0.8,
        pattern: /(['"`])gsk_[A-Za-z0-9]{40,}\1/g,
        message: 'Groq API key hardcoded',
        severity: 'high',
        fix: 'Move key to env var and rotate it via the Groq dashboard.'
      },
      {
        ruleId: 'AI001',
        confidence: 0.8,
        pattern: /(['"`])r8_[A-Za-z0-9]{30,}\1/g,
        message: 'Replicate API token hardcoded',
        severity: 'high',
        fix: 'Move token to env var and rotate it via Replicate account settings.'
      },
      {
        ruleId: 'AI001',
        confidence: 0.75,
        pattern: /(['"`])(?:co_|coh_)[A-Za-z0-9]{30,}\1/g,
        message: 'Cohere API key hardcoded',
        severity: 'high',
        fix: 'Move key to env var; rotate via Cohere dashboard.'
      }
    ],
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'mjs', 'cjs', 'env', 'json', 'yaml', 'yml']
  }
};

export default rule;
