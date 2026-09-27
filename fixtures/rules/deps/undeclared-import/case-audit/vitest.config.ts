import { defineConfig } from 'vitest/config'; // ok: subpath of a declared package

export default defineConfig({
  resolve: {
    alias: {
      '@ui': '/src/ui',
      testing: '/src/testing',
    },
  },
});
