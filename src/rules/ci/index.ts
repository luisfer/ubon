import type { Rule } from '../types.ts';
import { expressionInjection } from './expression-injection.ts';
import { publishToken } from './publish-token.ts';
import { untrustedCheckout } from './untrusted-checkout.ts';

export const ciRules: Rule[] = [expressionInjection, untrustedCheckout, publishToken];
