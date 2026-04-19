import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ScanResult, ScanOptions } from '../types';
import { BaseScanner } from './base-scanner';
import { getRule } from '../rules';
import { resolvesViaTsconfigPaths } from '../utils/tsconfig-resolver';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * VibeScanner: Detects patterns common in AI-generated "vibe coded" applications
 * 
 * Rules:
 * - VIBE001: Hallucinated imports (module not in package.json)
 * - VIBE002: Copy-paste artifacts (repeated blocks)
 * - VIBE003: Incomplete implementations (placeholders)
 * - VIBE004: Orphaned exports (unused exports)
 */
export class VibeScanner extends BaseScanner {
  name = 'Vibe Code Scanner';

  private packageDeps: Set<string> = new Set();
  private exports: Map<string, { file: string; line: number; name: string }[]> = new Map();
  private imports: Set<string> = new Set();

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    this.initCache(options, 'vibe:1');

    // Load package.json dependencies
    this.loadPackageDeps(options.directory);

    // First pass: collect exports and imports for cross-file analysis
    await this.collectExportsAndImports(options);

    // Second pass: run detection
    for await (const ctx of this.iterateFiles(options, '**/*.{js,jsx,ts,tsx,svelte,astro}', ['node_modules/**', 'dist/**', 'build/**', '.next/**'])) {
      if (this.hasFileSuppression(ctx.lines)) continue;

      const cached = this.getCached(ctx.file, ctx.contentHash);
      if (cached) {
        results.push(...cached);
        continue;
      }

      const fileResults: ScanResult[] = [];

      // VIBE001: Hallucinated imports
      fileResults.push(...this.detectHallucinatedImports(ctx.file, ctx.lines, options));

      // VIBE002: Copy-paste artifacts
      fileResults.push(...this.detectCopyPasteArtifacts(ctx.file, ctx.lines, options));

      // VIBE003: Incomplete implementations (pattern-based)
      fileResults.push(...this.detectIncompleteImplementations(ctx.file, ctx.lines, options));

      this.setCached(ctx.file, ctx.contentHash, fileResults);
      results.push(...fileResults);
    }

    // VIBE004: Orphaned exports (cross-file analysis)
    results.push(...this.detectOrphanedExports(options));

    this.saveCache();
    return results;
  }

  private loadPackageDeps(directory: string): void {
    this.packageDeps.clear();
    const pkgPath = join(directory, 'package.json');
    if (!existsSync(pkgPath)) return;

    try {
      const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      for (const dep of Object.keys(allDeps)) {
        this.packageDeps.add(dep);
        // Also add scoped package prefixes (e.g., @types/node -> @types)
        if (dep.startsWith('@')) {
          const scope = dep.split('/')[0];
          this.packageDeps.add(scope);
        }
      }
      // Add Node.js built-ins
      const builtins = [
        'fs', 'path', 'http', 'https', 'crypto', 'os', 'util', 'stream',
        'events', 'buffer', 'url', 'querystring', 'child_process', 'cluster',
        'dns', 'net', 'readline', 'repl', 'tls', 'dgram', 'vm', 'zlib',
        'assert', 'async_hooks', 'console', 'constants', 'domain', 'inspector',
        'module', 'perf_hooks', 'process', 'punycode', 'string_decoder',
        'timers', 'trace_events', 'tty', 'v8', 'worker_threads'
      ];
      builtins.forEach(b => {
        this.packageDeps.add(b);
        this.packageDeps.add(`node:${b}`);
      });
    } catch {}
  }

  private async collectExportsAndImports(options: ScanOptions): Promise<void> {
    this.exports.clear();
    this.imports.clear();

    for await (const ctx of this.iterateFiles(options, '**/*.{js,jsx,ts,tsx}', ['node_modules/**', 'dist/**', 'build/**', '.next/**'])) {
      // Collect exports
      ctx.lines.forEach((line, index) => {
        // Named exports: export const/function/class Name
        const namedExport = line.match(/export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/);
        if (namedExport) {
          const name = namedExport[1];
          if (!this.exports.has(name)) this.exports.set(name, []);
          this.exports.get(name)!.push({ file: ctx.file, line: index + 1, name });
        }

        // Export { name } or export { name as alias }
        const exportBraces = line.match(/export\s*\{([^}]+)\}/);
        if (exportBraces) {
          const names = exportBraces[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
          names.forEach(name => {
            if (name && !this.exports.has(name)) this.exports.set(name, []);
            if (name) this.exports.get(name)!.push({ file: ctx.file, line: index + 1, name });
          });
        }
      });

      // Collect imports
      ctx.lines.forEach(line => {
        // import { Name } from 'module'
        const importBraces = line.match(/import\s*\{([^}]+)\}\s*from/);
        if (importBraces) {
          const names = importBraces[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
          names.forEach(name => name && this.imports.add(name));
        }

        // import Name from 'module'
        const defaultImport = line.match(/import\s+(\w+)\s+from/);
        if (defaultImport) {
          this.imports.add(defaultImport[1]);
        }

        // import * as Name from 'module'
        const namespaceImport = line.match(/import\s+\*\s+as\s+(\w+)\s+from/);
        if (namespaceImport) {
          this.imports.add(namespaceImport[1]);
        }
      });
    }
  }

  private detectHallucinatedImports(file: string, lines: string[], options: ScanOptions): ScanResult[] {
    const results: ScanResult[] = [];
    const rule = getRule('VIBE001');
    if (!rule) return results;

    lines.forEach((line, index) => {
      if (this.isSuppressed(lines, index, 'VIBE001')) return;

      // Match import statements: import ... from 'module' or require('module')
      const importMatch = line.match(/(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/);
      if (!importMatch) return;

      const moduleName = importMatch[1] || importMatch[2];

      // Skip relative imports
      if (moduleName.startsWith('.') || moduleName.startsWith('/')) return;

      // Skip if the specifier resolves via `tsconfig.json` paths/baseUrl.
      // Covers the common `@/*` and `~/*` aliases used by Next.js, Vite,
      // shadcn, etc. — without this check every aliased import was flagged
      // as a hallucinated package.
      if (resolvesViaTsconfigPaths(moduleName, options.directory)) return;

      // Skip if it's a known dependency
      const baseName = moduleName.startsWith('@')
        ? moduleName.split('/').slice(0, 2).join('/')
        : moduleName.split('/')[0];

      if (this.packageDeps.has(baseName)) return;

      // Common false positives to skip — biased toward the v3 modern-JS scope
      // (Next/React/Vite/SvelteKit/Astro/Remix/Hono/Lovable). Vue is intentionally
      // omitted: ubon v3 dropped the Vue profile, and importing `vue` in a JS app
      // we scan is a strong-enough signal that the user should still see it.
      const commonModules = [
        'react',
        'react-dom',
        'next',
        'svelte',
        'astro',
        'hono',
        'express',
        'lodash',
        'axios',
        'zod'
      ];
      if (commonModules.includes(baseName)) return;
      // Common scoped namespaces that are routinely added without an exact
      // dep entry (workspaces, peer-deps installed transitively, etc.).
      const commonScopes = ['@sveltejs', '@remix-run', '@astrojs', '@hono', '@supabase', '@vercel'];
      if (baseName.startsWith('@') && commonScopes.some((s) => baseName === s || baseName.startsWith(`${s}/`))) return;

      results.push(this.createResult({
        type: 'error',
        category: rule.meta.category,
        message: `${rule.meta.message}: "${moduleName}"`,
        file,
        line: index + 1,
        severity: rule.meta.severity,
        ruleId: rule.meta.id,
        confidence: 0.85,
        confidenceReason: `Module "${baseName}" not found in package.json dependencies`,
        fix: rule.meta.fix,
        match: moduleName
      }, line));
    });

    return results;
  }

  private detectCopyPasteArtifacts(file: string, lines: string[], _options: ScanOptions): ScanResult[] {
    const results: ScanResult[] = [];
    const rule = getRule('VIBE002');
    if (!rule) return results;

    // Look for repeated 5+ line blocks
    const blockSize = 5;
    const blocks: Map<string, number[]> = new Map();

    for (let i = 0; i <= lines.length - blockSize; i++) {
      const block = lines.slice(i, i + blockSize)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('*'))
        .join('\n');
      
      if (block.length < 50) continue; // Skip trivial blocks

      if (!blocks.has(block)) {
        blocks.set(block, []);
      }
      blocks.get(block)!.push(i + 1);
    }

    // Report blocks that appear 2+ times
    const reported = new Set<number>();
    for (const [block, lineNumbers] of blocks) {
      if (lineNumbers.length < 2) continue;

      // Only report the second occurrence onwards
      for (let j = 1; j < lineNumbers.length; j++) {
        const lineNum = lineNumbers[j];
        if (reported.has(lineNum)) continue;
        if (this.isSuppressed(lines, lineNum - 1, 'VIBE002')) continue;

        reported.add(lineNum);
        results.push(this.createResult({
          type: 'warning',
          category: rule.meta.category,
          message: `${rule.meta.message} (also at line ${lineNumbers[0]})`,
          file,
          line: lineNum,
          severity: rule.meta.severity,
          ruleId: rule.meta.id,
          confidence: 0.7,
          confidenceReason: `${blockSize}+ line block appears ${lineNumbers.length} times in file`,
          fix: rule.meta.fix,
          match: block.slice(0, 100)
        }, lines[lineNum - 1]));
      }
    }

    return results;
  }

  private detectIncompleteImplementations(file: string, lines: string[], _options: ScanOptions): ScanResult[] {
    const results: ScanResult[] = [];
    const rule = getRule('VIBE003');
    if (!rule || !rule.impl.patterns) return results;

    for (const pattern of rule.impl.patterns) {
      lines.forEach((line, index) => {
        if (line.trim().startsWith('//') && !pattern.pattern.source.includes('//')) return;
        if (this.isSuppressed(lines, index, 'VIBE003')) return;

        // Skip rule definition files
        if (file.includes('/rules/') || file.includes('scanner')) return;

        const match = line.match(pattern.pattern);
        if (match) {
          results.push(this.createResult({
            type: pattern.severity === 'high' ? 'error' : 'warning',
            category: rule.meta.category,
            message: pattern.message,
            file,
            line: index + 1,
            severity: pattern.severity,
            ruleId: pattern.ruleId,
            confidence: pattern.confidence,
            fix: pattern.fix,
            match: match[0].slice(0, 100)
          }, line));
        }
      });
    }

    return results;
  }

  private detectOrphanedExports(_options: ScanOptions): ScanResult[] {
    const results: ScanResult[] = [];
    const rule = getRule('VIBE004');
    if (!rule) return results;

    // Skip common entry points and index files
    const skipPatterns = [/index\.[jt]sx?$/, /page\.[jt]sx?$/, /layout\.[jt]sx?$/, /route\.[jt]sx?$/];

    for (const [name, locations] of this.exports) {
      // Skip if imported anywhere
      if (this.imports.has(name)) continue;

      // Skip common React/Next patterns
      if (['default', 'getServerSideProps', 'getStaticProps', 'getStaticPaths', 'metadata', 'generateMetadata'].includes(name)) continue;

      for (const loc of locations) {
        // Skip index/entry files
        if (skipPatterns.some(p => p.test(loc.file))) continue;

        results.push({
          type: 'info',
          category: rule.meta.category,
          message: `${rule.meta.message}: "${name}"`,
          file: loc.file,
          line: loc.line,
          severity: rule.meta.severity,
          ruleId: rule.meta.id,
          confidence: 0.6,
          confidenceReason: `Export "${name}" not imported in any scanned file`,
          fix: rule.meta.fix,
          match: name
        });
      }
    }

    return results;
  }
}
