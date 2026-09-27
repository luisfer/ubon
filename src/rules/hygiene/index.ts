import type { Rule } from '../types.ts';
import { elidedCode } from './elided-code.ts';
import { placeholder } from './placeholder.ts';
import { variantFile } from './variant-file.ts';

export const hygieneRules: Rule[] = [elidedCode, placeholder, variantFile];
