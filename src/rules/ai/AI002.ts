import { Rule } from '../types';

/**
 * AI002: Prompt-injection sink.
 *
 * Flags places where user-controlled input is concatenated/templated directly
 * into an LLM prompt (system prompt, messages array, or `prompt:` field).
 *
 * The actual taint analysis lives in the AIScanner; this rule file only
 * carries metadata + an allowlist of file types so the scanner can stay
 * focused.
 */
const rule: Rule = {
  meta: {
    id: 'AI002',
    category: 'security',
    severity: 'high',
    message: 'User input flows into an LLM prompt without isolation (prompt injection sink)',
    fix: 'Pass untrusted input as a separate `user` message field, never as part of the system prompt or template string. Strip control tokens and consider an input guard model.',
    impact:
      'Prompt injection lets an attacker override your system prompt, exfiltrate secrets stored in tool definitions, or pivot to connected tools (RAG, MCP, email).',
    helpUri: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']
  }
};

export default rule;
