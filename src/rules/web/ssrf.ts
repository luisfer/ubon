import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { joinedToUnknown } from '../../lang/js.ts';
import { contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import { sinksOf } from './sinks.ts';

/**
 * Server-side requests to a URL taken from the request. A URL whose scheme and
 * host are fixed in code, with request data only in the path or query, is not
 * reported: the request cannot reach another host.
 */

/**
 * Names of validation helpers that clear the finding when called with the URL:
 * isAllowedUrl, isUrlAllowed, isSafeUrl, isAllowedHost, validateUrl,
 * assertAllowedUrl, checkUrl (any case).
 */
export function isSsrfHelper(name: string): boolean {
  if (!/(url|uri|host|hostname|domain|origin|endpoint)/i.test(name)) return false;
  return /^(validate|check|verify|assert|ensure)/i.test(name) || /^is.*(allowed|safe|trusted|permitted|whitelisted|allowlisted|valid|public|external)|^is(allowed|safe|trusted|permitted|whitelisted|allowlisted|valid|public|external)/i.test(name);
}

/** Libraries that block requests to private addresses at the connection level. */
export const SSRF_LIBRARIES = /^(request-filtering-agent|ssrf-req-filter|ssrf-agent|ssrfcheck|@hapi\/wreck-ssrf)$/;

export const ssrf: Rule = {
  meta: {
    id: 'web/ssrf',
    level: 'block',
    scope: 'file',
    title: 'Server request to a URL from the request',
    summary: 'Server-side fetch, axios, got, ky, undici, http.get, or page.goto whose URL (or host) comes from request data.',
    why: 'The server makes the request from inside your network, so whoever controls the URL can reach internal services and cloud metadata endpoints (169.254.169.254) and read the responses.',
    fix: 'Parse the URL with new URL() and check its hostname against an allowlist before fetching, or build the URL from a fixed base and pass the value only as a path segment or query parameter.',
    cwe: ['CWE-918'],
    owasp: ['A01:2025'],
    levels:
      "block when request data controls the scheme or host of the URL; warn when the data is appended directly to a base Ubon cannot read (it changes the host only if the base does not end with '/'), when the value passed a schema whose constraints Ubon cannot read, and in example or template folders. A fixed scheme and host with request data in the path or query is not reported.",
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    if (ctx.side === 'client') return {};
    if (ctx.imports.importsModule(SSRF_LIBRARIES)) return {};
    // Whether the file ships to the browser is looked up only when a finding is possible (it reads the project graph).
    let browserOnly: boolean | undefined;
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'fetch') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live, true);
        if (!hit) continue;
        browserOnly ??= ctx.file.client && !ctx.file.server;
        if (browserOnly) return;
        if (findGuard(ctx, sink, live.filter((l) => l.taint.kind === 'request'), ['host', 'allowlist', 'regex'], isSsrfHelper).cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        const schema = schemaChecked(hit.taint);
        // `${BASE}${value}`: whether the value can change the host depends on how BASE ends.
        const joined = joinedToUnknown(hit.taint.prefix);
        ctx.report(sink.node, {
          message: schema
            ? `${sink.name} uses a URL from ${hit.taint.source} ${where(label, hit.taint)}, checked only by a schema whose constraints Ubon cannot read.`
            : joined
              ? `${sink.name} uses a URL that appends ${hit.taint.source} ${where(label, hit.taint)} directly to a base Ubon cannot read, so the value can change the host unless the base ends with '/'.`
              : `${sink.name} uses a URL from ${hit.taint.source} ${where(label, hit.taint)}.`,
          level: contextLevel(ctx.file, schema || joined ? 'warn' : 'block'),
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
