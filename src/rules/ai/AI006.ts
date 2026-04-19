import { Rule } from '../types';

/**
 * AI006: Tool / function-calling handler exposed without auth or allowlist.
 *
 * When an LLM can invoke `tools: [...]` and the handler is a Next.js route
 * / Hono endpoint / Express handler with no auth check, a prompt-injected
 * model becomes a confused deputy: it can read the filesystem, call DBs,
 * or send emails on behalf of any user.
 *
 * Detection in AIScanner: looks for `tools:` arrays whose `execute` /
 * handler reaches into `fs`, `child_process`, network fetches, or DB
 * clients without an upstream auth guard.
 */
const rule: Rule = {
  meta: {
    id: 'AI006',
    category: 'security',
    severity: 'high',
    message: 'LLM tool/function handler missing auth or capability allowlist',
    fix: 'Wrap the tool handler in an auth check, scope it to the current user, and validate arguments with zod/valibot before execution.',
    impact:
      'Without an auth boundary, prompt injection turns the LLM into an attacker: it can call your tools, read your DB and exfiltrate data.',
    helpUri: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']
  }
};

export default rule;
