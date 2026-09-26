#!/usr/bin/env node
// Build: bundle the CLI and the API into dist/ with esbuild. Runtime
// dependencies (the Babel parser, yaml) are bundled, so the published
// package installs nothing. Output is deterministic for a given source tree.
import { chmodSync, copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: { index: 'src/index.ts', cli: 'src/cli/bin.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.18',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
  metafile: false,
});

// A tiny entry that enables Node's compile cache before loading the bundle.
writeFileSync(
  join(dist, 'ubon.mjs'),
  `#!/usr/bin/env node
// Ubon command-line entry. See https://github.com/luisfer/ubon
import module from 'node:module';
try {
  module.enableCompileCache?.();
} catch {
  // the cache is an optimization only
}
const { run } = await import('./cli.mjs');
await run();
`,
);
chmodSync(join(dist, 'ubon.mjs'), 0o755);
copyFileSync(join(root, 'types', 'index.d.ts'), join(dist, 'index.d.ts'));

let total = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else total += st.size;
  }
};
walk(dist);
console.log(`dist: ${(total / 1024).toFixed(0)} KB`);
