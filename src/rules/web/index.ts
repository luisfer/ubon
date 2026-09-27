import type { Rule } from '../types.ts';
import { codeEval } from './code-eval.ts';
import { commandInjection } from './command-injection.ts';
import { corsCredentialsWildcard } from './cors-credentials-wildcard.ts';
import { insecureCookie } from './insecure-cookie.ts';
import { jwtUnverified } from './jwt-unverified.ts';
import { openRedirect } from './open-redirect.ts';
import { pathTraversal } from './path-traversal.ts';
import { sqlInjection } from './sql-injection.ts';
import { ssrf } from './ssrf.ts';
import { tokenInWebStorage } from './token-in-web-storage.ts';
import { weakTokenRandomness } from './weak-token-randomness.ts';
import { webhookUnverified } from './webhook-unverified.ts';
import { xssHtmlSink } from './xss-html-sink.ts';

export const webRules: Rule[] = [
  sqlInjection,
  commandInjection,
  ssrf,
  pathTraversal,
  codeEval,
  xssHtmlSink,
  webhookUnverified,
  weakTokenRandomness,
  corsCredentialsWildcard,
  jwtUnverified,
  openRedirect,
  insecureCookie,
  tokenInWebStorage,
];
