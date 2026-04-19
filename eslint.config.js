// ESLint 9 flat config for Ubon.
// Kept intentionally minimal — Ubon's job is to find security issues, not to
// re-implement code style. We rely on TypeScript for correctness and
// @typescript-eslint for the few semantic rules that catch real bugs.

const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'examples/**',
      'vscode-extension/**',
      'scripts/**',
      'docs/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `catch (error)` is idiomatic Node — don't fail lint when the
          // body opts not to inspect the value. This matches `no-empty`
          // `allowEmptyCatch` below.
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      // `@ts-ignore` is acceptable for dynamic-import shims and optional
      // peer deps that have no types installed. We prefer @ts-expect-error
      // where possible but won't gate releases on it.
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
