import type { Rule } from '../types.ts';
import { installScript } from './install-script.ts';
import { knownMalicious } from './known-malicious.ts';
import { nonRegistrySource } from './non-registry-source.ts';
import { nonexistentPackage } from './nonexistent-package.ts';
import { typosquat } from './typosquat.ts';
import { undeclaredImport } from './undeclared-import.ts';
import { youngPackage } from './young-package.ts';

export const depsRules: Rule[] = [undeclaredImport, nonexistentPackage, youngPackage, typosquat, installScript, nonRegistrySource, knownMalicious];
