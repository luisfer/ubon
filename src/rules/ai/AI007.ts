import { Rule } from '../types';

/**
 * AI007: Streaming LLM endpoint without auth / rate limit.
 *
 * Public `streamText` / `OpenAIStream` / SSE endpoints are the #1 target for
 * key-bombing: a single un-rate-limited route can drain a free-tier credit
 * line in hours.
 */
const rule: Rule = {
  meta: {
    id: 'AI007',
    category: 'security',
    severity: 'high',
    message: 'LLM streaming endpoint missing auth and/or rate limiting',
    fix: 'Require an authenticated session on the route and add a per-user/IP rate limiter (e.g. Upstash Ratelimit, Vercel KV) before invoking the model.',
    impact:
      'Open streaming endpoints are scraped by abuse bots within hours of deploy and burn through API quotas.',
    helpUri: 'https://vercel.com/docs/security/ddos-mitigation'
  },
  impl: {
    fileTypes: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']
  }
};

export default rule;
