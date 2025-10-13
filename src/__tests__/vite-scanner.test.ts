import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ViteScanner } from '../scanners/vite-scanner';

describe('ViteScanner', () => {
  const tmp = join(process.cwd(), '.tmp-vite-tests');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(tmp, { recursive: true });
    // Create vite.config.ts to indicate this is a Vite project
    writeFileSync(join(tmp, 'vite.config.ts'), `
      import { defineConfig } from 'vite';
      export default defineConfig({});
    `);
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  describe('VITE001: Non-VITE_ Prefixed Environment Variables', () => {
    it('detects environment variables without VITE_ prefix', async () => {
      const file = join(tmp, 'env-usage.ts');
      writeFileSync(file, `
        const apiUrl = import.meta.env.API_URL;
        const apiKey = import.meta.env.SECRET_KEY;
        const dbHost = import.meta.env.DATABASE_HOST;
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite001Results = results.filter(r => r.ruleId === 'VITE001');
      expect(vite001Results.length).toBeGreaterThanOrEqual(3);
    });

    it('detects mixed valid and invalid env vars', async () => {
      const file = join(tmp, 'mixed-env.ts');
      writeFileSync(file, `
        const apiUrl = import.meta.env.VITE_API_URL; // Valid
        const secret = import.meta.env.SECRET; // Invalid
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite001Results = results.filter(r =>
        r.ruleId === 'VITE001' && r.file?.includes('mixed-env.ts')
      );
      expect(vite001Results.length).toBe(1);
      expect(vite001Results[0].message).toContain('VITE_');
    });

    it('does not flag VITE_ prefixed variables', async () => {
      const file = join(tmp, 'valid-env.ts');
      writeFileSync(file, `
        const apiUrl = import.meta.env.VITE_API_URL;
        const publicKey = import.meta.env.VITE_PUBLIC_KEY;
        const appName = import.meta.env.VITE_APP_NAME;
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite001Results = results.filter(r =>
        r.ruleId === 'VITE001' && r.file?.includes('valid-env.ts')
      );
      expect(vite001Results.length).toBe(0);
    });

    it('does not flag special Vite variables (MODE, DEV, PROD, SSR, BASE_URL)', async () => {
      const file = join(tmp, 'special-vars.ts');
      writeFileSync(file, `
        const mode = import.meta.env.MODE;
        const isDev = import.meta.env.DEV;
        const isProd = import.meta.env.PROD;
        const isSSR = import.meta.env.SSR;
        const baseUrl = import.meta.env.BASE_URL;
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite001Results = results.filter(r =>
        r.ruleId === 'VITE001' && r.file?.includes('special-vars.ts')
      );
      expect(vite001Results.length).toBe(0);
    });

    it('detects env vars in JSX expressions', async () => {
      const file = join(tmp, 'jsx-env.tsx');
      writeFileSync(file, `
        import React from 'react';

        export function ApiComponent() {
          return <div>{import.meta.env.API_ENDPOINT}</div>;
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite001Results = results.filter(r =>
        r.ruleId === 'VITE001' && r.file?.includes('jsx-env.tsx')
      );
      expect(vite001Results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('VITE002: Development Code Without Production Fallback', () => {
    it('detects DEV check without else clause', async () => {
      const file = join(tmp, 'dev-only.ts');
      writeFileSync(file, `
        if (import.meta.env.DEV) {
          console.log('Debug info:', data);
        }
        // No else clause - missing production fallback
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite002Results = results.filter(r => r.ruleId === 'VITE002');
      expect(vite002Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects MODE === "development" without else', async () => {
      const file = join(tmp, 'mode-dev.ts');
      writeFileSync(file, `
        if (import.meta.env.MODE === 'development') {
          api.enableDebugMode();
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite002Results = results.filter(r =>
        r.ruleId === 'VITE002' && r.file?.includes('mode-dev.ts')
      );
      expect(vite002Results.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag when else clause is present', async () => {
      const file = join(tmp, 'with-fallback.ts');
      writeFileSync(file, `
        if (import.meta.env.DEV) {
          console.log('Debug info:', data);
        } else {
          // Production logging
          logger.info('Request processed');
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite002Results = results.filter(r =>
        r.ruleId === 'VITE002' && r.file?.includes('with-fallback.ts')
      );
      expect(vite002Results.length).toBe(0);
    });

    it('does not flag ternary operators', async () => {
      const file = join(tmp, 'ternary.ts');
      writeFileSync(file, `
        const apiUrl = import.meta.env.DEV ? 'http://localhost:3000' : 'https://api.example.com';
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite002Results = results.filter(r =>
        r.ruleId === 'VITE002' && r.file?.includes('ternary.ts')
      );
      expect(vite002Results.length).toBe(0);
    });

    it('detects !PROD check without else', async () => {
      const file = join(tmp, 'not-prod.ts');
      writeFileSync(file, `
        if (!import.meta.env.PROD) {
          mockData.initialize();
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite002Results = results.filter(r =>
        r.ruleId === 'VITE002' && r.file?.includes('not-prod.ts')
      );
      expect(vite002Results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('VITE003: Unsafe Dynamic Imports', () => {
    it('detects dynamic import with template literal and variable', async () => {
      const file = join(tmp, 'dynamic-import.ts');
      writeFileSync(file, `
        export async function loadModule(moduleName: string) {
          const module = await import(\`./modules/\${moduleName}.ts\`);
          return module;
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite003Results = results.filter(r => r.ruleId === 'VITE003');
      expect(vite003Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects dynamic import with user input', async () => {
      const file = join(tmp, 'user-import.ts');
      writeFileSync(file, `
        export async function loadUserComponent(componentName: string) {
          // User controls the import path - dangerous!
          const Component = await import(\`@/components/\${componentName}\`);
          return Component;
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite003Results = results.filter(r =>
        r.ruleId === 'VITE003' && r.file?.includes('user-import.ts')
      );
      expect(vite003Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects import with string concatenation', async () => {
      const file = join(tmp, 'concat-import.ts');
      writeFileSync(file, `
        export async function loadPlugin(name: string) {
          const plugin = await import('./plugins/' + name + '.js');
          return plugin;
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite003Results = results.filter(r =>
        r.ruleId === 'VITE003' && r.file?.includes('concat-import.ts')
      );
      expect(vite003Results.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag static imports', async () => {
      const file = join(tmp, 'static-import.ts');
      writeFileSync(file, `
        export async function loadDashboard() {
          const module = await import('./pages/Dashboard');
          return module;
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite003Results = results.filter(r =>
        r.ruleId === 'VITE003' && r.file?.includes('static-import.ts')
      );
      expect(vite003Results.length).toBe(0);
    });

    it('does not flag validated dynamic imports', async () => {
      const file = join(tmp, 'validated-import.ts');
      writeFileSync(file, `
        const allowedModules = ['dashboard', 'settings', 'profile'];

        export async function loadModule(name: string) {
          if (!allowedModules.includes(name)) {
            throw new Error('Invalid module');
          }
          const module = await import(\`./pages/\${name}\`);
          return module;
        }
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const vite003Results = results.filter(r =>
        r.ruleId === 'VITE003' && r.file?.includes('validated-import.ts')
      );
      expect(vite003Results.length).toBe(0);
    });
  });

  describe('Integration Tests', () => {
    it('only scans projects with vite.config or import.meta usage', async () => {
      // Clean tmp directory and create fresh for this test
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });

      const file = join(tmp, 'no-vite.ts');
      writeFileSync(file, `
        const config = {
          api: 'https://example.com'
        };
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      // Should return empty because no vite.config and no import.meta usage
      expect(results.length).toBe(0);

      // Restore vite.config.ts
      writeFileSync(join(tmp, 'vite.config.ts'), `
        import { defineConfig } from 'vite';
        export default defineConfig({});
      `);
    });

    it('scans files with import.meta even without vite.config', async () => {
      // Remove vite.config.ts
      rmSync(join(tmp, 'vite.config.ts'), { force: true });

      const file = join(tmp, 'has-import-meta.ts');
      writeFileSync(file, `
        const url = import.meta.url;
        const env = import.meta.env.API_KEY;
      `);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const hasImportMetaResults = results.filter(r => r.file?.includes('has-import-meta.ts'));
      expect(hasImportMetaResults.length).toBeGreaterThanOrEqual(1);

      // Restore vite.config.ts
      writeFileSync(join(tmp, 'vite.config.ts'), `
        import { defineConfig } from 'vite';
        export default defineConfig({});
      `);
    });

    it('scans multiple file types (.js, .jsx, .ts, .tsx, .vue)', async () => {
      const jsFile = join(tmp, 'test.js');
      const tsFile = join(tmp, 'test.ts');
      const jsxFile = join(tmp, 'test.jsx');
      const tsxFile = join(tmp, 'test.tsx');
      const vueFile = join(tmp, 'test.vue');

      const code = `const key = import.meta.env.SECRET_KEY;`;

      writeFileSync(jsFile, code);
      writeFileSync(tsFile, code);
      writeFileSync(jsxFile, code);
      writeFileSync(tsxFile, code);
      writeFileSync(vueFile, `<script>${code}</script>`);

      const scanner = new ViteScanner();
      const results = await scanner.scan({ directory: tmp });
      const testResults = results.filter(r => r.file?.startsWith('test.'));
      expect(testResults.length).toBeGreaterThanOrEqual(5);
    });
  });
});
