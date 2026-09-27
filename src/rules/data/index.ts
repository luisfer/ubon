import type { Rule } from '../types.ts';
import { firebaseOpenRules } from './firebase-open-rules.ts';
import { permissivePolicy } from './permissive-policy.ts';
import { rlsDisabled } from './rls-disabled.ts';
import { serviceRoleInClient } from './service-role-in-client.ts';

export const dataRules: Rule[] = [rlsDisabled, permissivePolicy, serviceRoleInClient, firebaseOpenRules];
