import type { Node } from '@babel/types';
import type { Rule } from '../types.ts';
import { joinedToUnknown } from '../../lang/js.ts';
import { contextLevel, findGuard, isCheckedCode, liveTaints, requestTaint, schemaChecked, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import { sinksOf } from './sinks.ts';

/**
 * Server-side requests to a URL taken from the request. A URL whose scheme and
 * host are fixed in code, with request data only in the path or query, is not
 * reported: the request cannot reach another host. Checks on a URL parsed from
 * the value (`parsed = new URL(url)`) count as checks on the value.
 */

/**
 * Names of validation helpers that clear the finding when called with the URL:
 * isAllowedUrl, isUrlAllowed, isSafeUrl, isAllowedHost, validateUrl,
 * assertAllowedUrl, checkUrl (any case). isValidUrl is not one of them: it
 * usually checks only that the text parses as a URL. Helpers named for public
 * or private addresses (isPublicUrl) are private address checks.
 */
export function isSsrfHelper(name: string): boolean {
  if (!/(url|uri|host|hostname|domain|origin|endpoint)/i.test(name)) return false;
  return /^(validate|check|verify|assert|ensure)/i.test(name) || /^is.*(allowed|safe|trusted|permitted|whitelisted|allowlisted)|^is(allowed|safe|trusted|permitted|whitelisted|allowlisted)/i.test(name);
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
      "block when request data controls the scheme or host of the URL, including when the host is only compared with 'localhost' or checked against private addresses without a DNS lookup; warn when the address the host resolves to is checked against private ranges (DNS can answer differently when the request connects), when the data is appended directly to a base Ubon cannot read (it changes the host only if the base is a scheme and host without a path), when the value passed a schema whose constraints Ubon cannot read, and in example or template folders. A fixed scheme and host with request data in the path or query is not reported.",
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
        const guard = findGuard(ctx, sink, live.filter((l) => l.taint.kind === 'request'), ['host', 'allowlist', 'regex', 'private'], isSsrfHelper);
        if (guard.cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        const from = `${hit.taint.source} ${where(label, hit.taint)}`;
        const schema = schemaChecked(hit.taint);
        // `${BASE}${value}`: whether the value can change the host depends on how BASE ends.
        const joined = joinedToUnknown(hit.taint.prefix);
        // A DNS lookup and a private address check: the name can resolve to another address when the request connects.
        const resolved = guard.privateCheck === 'resolved';
        ctx.report(sink.node, {
          message: resolved
            ? `${sink.name} uses a URL from ${from} whose host is checked against private addresses only; DNS can return another address when the request connects, so check the host against an allowlist or pin the request to the resolved address.`
            : schema
              ? `${sink.name} uses a URL from ${from}, checked only by a schema whose constraints Ubon cannot read.`
              : joined
                ? `${sink.name} uses a URL that appends ${from} directly to a base Ubon cannot read; if the base is only a scheme and host, the value can change the host.`
                : guard.privateCheck === 'unresolved'
                  ? `${sink.name} uses a URL from ${from} whose host is checked against private addresses without a DNS lookup, so a host name that resolves to an internal address passes.`
                  : `${sink.name} uses a URL from ${from}.`,
          level: contextLevel(ctx.file, resolved || schema || joined ? 'warn' : 'block'),
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
