import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: { // expect-block: integrity/checks-weakened
      provider: 'v8',
      thresholds: {
        lines: 70, // expect-block: integrity/checks-weakened
        // ok: raising a threshold is never reported
        functions: 90,
        // ok: statements unchanged
        statements: 90,
      },
    },
  },
});
