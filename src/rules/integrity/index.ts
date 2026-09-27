import type { Rule } from '../types.ts';
import { checksWeakened } from './checks-weakened.ts';
import { lintSuppression } from './lint-suppression.ts';
import { newSuppression } from './new-suppression.ts';
import { invalidSuppression, unusedSuppression } from './suppressions.ts';
import { testDeleted } from './test-deleted.ts';
import { testSkipped } from './test-skipped.ts';
import { typeSuppression } from './type-suppression.ts';

export const integrityRules: Rule[] = [invalidSuppression, unusedSuppression, testSkipped, testDeleted, typeSuppression, lintSuppression, checksWeakened, newSuppression];
