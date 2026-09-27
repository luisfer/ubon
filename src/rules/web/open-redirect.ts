import type { Node } from '@babel/types';
import { joinedToUnknown } from '../../lang/js.ts';
import type { Rule } from '../types.ts';
import { findGuard, isCheckedCode, liveTaints, requestTaint, sinkVisitors, traceOf, valueLabel, where } from './flow.ts';
import { sinksOf } from './sinks.ts';

/**
 * Redirects to a target taken from the request. Targets whose origin is fixed
 * by the code (`new URL('/path', request.url)`, `/login?next=${x}`) are safe,
 * and a same-origin check on the target clears the finding.
 */

/**
 * Helpers that validate or rewrite redirect targets: isSafeRedirect,
 * isRedirectAllowed, validateReturnTo, isRelativeUrl, isSameOrigin, safeRedirect.
 */
function isRedirectHelper(name: string): boolean {
  if (/^(isSameOrigin|isRelativeUrl|isRelativePath|isLocalUrl|isInternalUrl|safeRedirect|getSafeRedirect|sanitizeRedirect)$/i.test(name)) return true;
  if (!/(redirect|url|uri|path|return|callback|next|destination|target)/i.test(name)) return false;
  return /^(validate|check|verify|assert|ensure)/i.test(name) || /(safe|valid|allowed|trusted|local|relative|internal|sameorigin|whitelisted|allowlisted)/i.test(name);
}

export const openRedirect: Rule = {
  meta: {
    id: 'web/open-redirect',
    level: 'warn',
    scope: 'file',
    title: 'Redirect to a URL from the request',
    summary:
      'redirect() (Next.js, Remix, React Router, SvelteKit), NextResponse.redirect, Response.redirect, res.redirect, c.redirect, a Location header, router.push or router.replace, or location.href with a target from request data and no same-origin check.',
    why: 'A link to your site that forwards to a look-alike site borrows the trust people have in your domain, which makes phishing pages and stolen OAuth codes look legitimate.',
    fix: "Accept only relative paths (target.startsWith('/') && !target.startsWith('//')), or compare new URL(target, base).origin with your own origin before redirecting.",
    cwe: ['CWE-601'],
    owasp: ['A01:2025'],
  },
  appliesTo: isCheckedCode,
  js(ctx) {
    return sinkVisitors(ctx, (node: Node) => {
      for (const sink of sinksOf(ctx, node)) {
        if (sink.category !== 'redirect') continue;
        const live = liveTaints(ctx, sink);
        const hit = requestTaint(live);
        if (!hit) continue;
        const guard = findGuard(ctx, sink, live.filter((l) => l.taint.kind === 'request'), ['relative', 'origin', 'allowlist', 'regex'], isRedirectHelper);
        if (guard.cleared) continue;
        const label = valueLabel(ctx, hit.value, hit.taint);
        ctx.report(sink.node, {
          message: guard.slashOnly
            ? `${sink.name} sends the user to a URL from ${hit.taint.source} ${where(label, hit.taint)} that is checked for a leading '/' but not for '//', so '//other-site.example' passes.`
            : joinedToUnknown(hit.taint.prefix) || /^[a-z][a-z0-9+.-]*:\/\/[\u0000\u0001]+$/i.test(hit.taint.prefix ?? '')
              ? `${sink.name} appends ${hit.taint.source} ${where(label, hit.taint)} directly to another value, so a target such as '@other-site.example' changes the host.`
              : `${sink.name} sends the user to a URL from ${hit.taint.source} ${where(label, hit.taint)} without a same-origin check.`,
          level: 'warn',
          trace: traceOf(label, hit.taint, sink),
          key: label,
        });
      }
    });
  },
};
