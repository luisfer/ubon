import type { Rule } from '../types.ts';
import { invalidSuppression, unusedSuppression } from './suppressions.ts';

export const integrityRules: Rule[] = [invalidSuppression, unusedSuppression];
