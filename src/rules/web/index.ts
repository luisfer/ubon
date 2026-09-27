import type { Rule } from '../types.ts';
import { codeEval } from './code-eval.ts';
import { commandInjection } from './command-injection.ts';
import { openRedirect } from './open-redirect.ts';
import { pathTraversal } from './path-traversal.ts';
import { sqlInjection } from './sql-injection.ts';
import { ssrf } from './ssrf.ts';
import { xssHtmlSink } from './xss-html-sink.ts';

export const webRules: Rule[] = [sqlInjection, commandInjection, ssrf, pathTraversal, codeEval, xssHtmlSink, openRedirect];
