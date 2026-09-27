import { defineConfig } from 'vite';

const flags = process.env.BUILD_FLAGS ?? '{}';

export default defineConfig({
  define: eval(`(${flags})`), // ok: build tool config files are not checked
});
