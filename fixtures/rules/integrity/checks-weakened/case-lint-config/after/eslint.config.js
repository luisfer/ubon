import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'warn', // expect-block: integrity/checks-weakened
      eqeqeq: ['error', 'always'],
      // ok: a rule that was only a warning turned off is not a weakened check
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': ['off'], // expect-block: integrity/checks-weakened
      // ok: a new rule at error raises strictness
      'no-debugger': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // ok: this override was already off for tests
      'no-console': 'off',
    },
  },
);
