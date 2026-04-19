import { Rule } from '../types';

/**
 * AI003: System prompt or model config exposed to client bundle.
 *
 * Flags `NEXT_PUBLIC_` (or `VITE_`, `PUBLIC_`) env vars whose name suggests
 * a system prompt / model config, plus literal `system: '...'` blocks
 * defined inside `'use client'` files. The system prompt is *not* a secret
 * in the cryptographic sense, but exposing it lets users craft tailored
 * jailbreaks and reveals proprietary business logic.
 */
const rule: Rule = {
  meta: {
    id: 'AI003',
    category: 'security',
    severity: 'medium',
    message: 'System prompt or LLM config defined in client-side code',
    fix: 'Move the system prompt to a server route / server action and only return the model output to the client.',
    impact:
      'A leaked system prompt makes jailbreaks trivial and exposes proprietary product logic to competitors.',
    helpUri: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'svelte', 'astro', 'env']
  }
};

export default rule;
