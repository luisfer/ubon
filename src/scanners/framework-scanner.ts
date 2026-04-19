import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ScanOptions, ScanResult } from '../types';
import { BaseScanner } from './base-scanner';
import { getRule } from '../rules';
import { redact } from '../utils/redact';

/**
 * FrameworkScanner — Next 14/15 Server Actions, Edge runtime, SvelteKit,
 * Astro, Remix, Hono, Drizzle, and Prisma.
 *
 * Heuristic regex-based detections (intentionally not full AST) so each
 * rule stays cheap and explainable. Every finding ships with a
 * `confidenceReason`; lower-confidence rules surface only with `--detailed`.
 */
export class FrameworkScanner extends BaseScanner {
  name = 'Framework Scanner';

  private readonly authMarkerRegex =
    /\b(getServerSession|auth\(\)|getSession|verifyJWT|requireAuth|requireUser|requireUserId|withAuth|isAuthenticated|currentUser|clerkClient|supabase\.auth|next-auth|lucia|betterAuth|verifyToken|locals\.user|Astro\.locals\.user|event\.locals\.user)\b/;

  private readonly validatorMarkerRegex =
    /\b(zod|valibot|yup|ajv|safeParse|parse\s*\(|zValidator|@hapi\/joi|joi\.|superstruct|arktype|class-validator)\b/;

  // Cached per-scan: is this project using Next.js? NEXT* rules gate on this
  // so a Vite+React SPA doesn't light up with App Router findings.
  private isNextProject: boolean = false;

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    this.initCache(options, 'framework:2');
    this.isNextProject = this.detectNextProject(options.directory);

    for await (const ctx of this.iterateFiles(
      options,
      '**/*.{js,jsx,ts,tsx,mjs,cjs,svelte,astro}',
      ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'coverage/**', 'examples/**']
    )) {
      if (this.hasFileSuppression(ctx.lines)) continue;
      const cached = this.getCached(ctx.file, ctx.contentHash);
      if (cached) {
        results.push(...cached);
        continue;
      }

      const fileResults: ScanResult[] = [];
      fileResults.push(...this.detectNextServerActions(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectUseServerLeak(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectEdgeRuntime(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectSvelteKit(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectAstroEndpoints(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectRemix(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectHono(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectDrizzlePrisma(ctx.file, ctx.content, ctx.lines));
      if (this.isNextProject) {
        fileResults.push(...this.detectNext15AsyncParams(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectMissingUseClient(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectNextConfigHints(ctx.file, ctx.content, ctx.lines));
        fileResults.push(...this.detectNextAppRouterBoundaries(ctx.file, ctx.content, ctx.lines));
      }

      this.setCached(ctx.file, ctx.contentHash, fileResults);
      results.push(...fileResults);
    }

    this.saveCache();
    return results;
  }

  private detectNextProject(directory: string): boolean {
    try {
      const pkgPath = join(directory, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.dependencies?.next || pkg.devDependencies?.next) return true;
      }
    } catch {}
    return (
      existsSync(join(directory, 'next.config.js')) ||
      existsSync(join(directory, 'next.config.ts')) ||
      existsSync(join(directory, 'next.config.mjs')) ||
      existsSync(join(directory, 'next.config.cjs'))
    );
  }

  // -------- Next.js Server Actions (NEXT212–215) ------------------------

  private detectNextServerActions(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    if (!/['"]use server['"];?/.test(content)) return out;

    // NEXT212/213: scan exported async functions in this server-actions file.
    const exportFnRegex =
      /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|export\s+const\s+(\w+)\s*=\s*async\s*\(([^)]*)\)\s*=>/g;
    const fileHasAuth = this.authMarkerRegex.test(content);
    const fileHasValidator = this.validatorMarkerRegex.test(content);

    let m: RegExpExecArray | null;
    while ((m = exportFnRegex.exec(content))) {
      const name = m[1] || m[3];
      const args = (m[2] || m[4] || '').trim();
      if (!name) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      if (this.isSuppressed(lines, lineIndex, 'NEXT212')) continue;

      // NEXT212: missing auth
      if (!fileHasAuth) {
        const meta = getRule('NEXT212')?.meta;
        if (meta) {
          out.push(
            this.createResult(
              {
                type: 'error',
                category: 'security',
                severity: meta.severity,
                ruleId: meta.id,
                message: `${meta.message} (export: ${name})`,
                fix: meta.fix,
                file,
                line: lineIndex + 1,
                match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
                confidence: 0.65,
                confidenceReason:
                  'File has `use server` directive but no auth marker (auth()/getServerSession/etc.) anywhere in the module.'
              },
              lines[lineIndex]
            )
          );
        }
      }

      // NEXT213: missing input validation when handler accepts FormData/object
      if (args && !fileHasValidator) {
        const acceptsRichInput = /\b(formData|FormData|data|input|payload|body)\b/.test(args);
        if (acceptsRichInput) {
          const meta = getRule('NEXT213')?.meta;
          if (meta) {
            out.push(
              this.createResult(
                {
                  type: 'error',
                  category: 'security',
                  severity: meta.severity,
                  ruleId: meta.id,
                  message: `${meta.message} (export: ${name})`,
                  fix: meta.fix,
                  file,
                  line: lineIndex + 1,
                  match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
                  confidence: 0.55,
                  confidenceReason:
                    'Server Action accepts FormData/object input but no validator (zod/valibot/yup/ajv) is imported in the file.'
                },
                lines[lineIndex]
              )
            );
          }
        }
      }
    }

    // NEXT215: redirect()/revalidatePath() with template-literal user input
    const dangerousCallRegex =
      /\b(?:redirect|revalidatePath|revalidateTag)\s*\(\s*`[^`]*\$\{[^}]*\b(?:formData|input|data|body|params|searchParams|request)\b[^}]*\}[^`]*`/g;
    let dm: RegExpExecArray | null;
    while ((dm = dangerousCallRegex.exec(content))) {
      const lineIndex = content.slice(0, dm.index).split('\n').length - 1;
      if (this.isSuppressed(lines, lineIndex, 'NEXT215')) continue;
      const meta = getRule('NEXT215')?.meta;
      if (!meta) continue;
      out.push(
        this.createResult(
          {
            type: 'error',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
            confidence: 0.7,
            confidenceReason:
              'redirect()/revalidatePath() interpolates user-controlled input from formData/params/etc.'
          },
          lines[lineIndex]
        )
      );
    }

    return out;
  }

  // -------- NEXT214: `use server` imported by `use client` --------------

  private detectUseServerLeak(file: string, content: string, lines: string[]): ScanResult[] {
    if (!/['"]use client['"];?/.test(content)) return [];
    const meta = getRule('NEXT214')?.meta;
    if (!meta) return [];

    const out: ScanResult[] = [];
    const importRegex = /import\s+[^'"`]+from\s+['"]([^'"`]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(content))) {
      const importPath = m[1];
      // Heuristic: imports with `actions` or `server-actions` segments
      // are the typical Server Action modules. We can't follow paths, so
      // we report the suspicious import so the user can confirm.
      if (!/(?:^|\/)(?:actions|server-actions|server)\/[\w./-]+$/.test(importPath)) continue;
      if (importPath.startsWith('http')) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      if (this.isSuppressed(lines, lineIndex, 'NEXT214')) continue;
      out.push(
        this.createResult(
          {
            type: 'warning',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
            confidence: 0.5,
            confidenceReason: `\`use client\` file imports from a likely server-actions module ('${importPath}').`
          },
          lines[lineIndex]
        )
      );
    }
    return out;
  }

  // -------- Edge runtime (EDGE001–003) ---------------------------------

  private detectEdgeRuntime(file: string, content: string, lines: string[]): ScanResult[] {
    if (!/export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(content)) return [];

    const out: ScanResult[] = [];

    // EDGE001: node-only APIs
    const nodeApiRegex =
      /\b(?:from\s+['"](?:fs|fs\/promises|child_process|cluster|dgram|net|tls|dns|os|worker_threads|stream\/web)['"]|require\s*\(\s*['"](?:fs|child_process|cluster|dgram|net|tls)['"]\s*\)|crypto\.createHash|Buffer\.from)/g;
    let m: RegExpExecArray | null;
    while ((m = nodeApiRegex.exec(content))) {
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      if (this.isSuppressed(lines, lineIndex, 'EDGE001')) continue;
      const meta = getRule('EDGE001')?.meta;
      if (!meta) continue;
      out.push(
        this.createResult(
          {
            type: 'error',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
            confidence: 0.85,
            confidenceReason: 'Node-only API used in a route declared with `runtime = "edge"`.'
          },
          lines[lineIndex]
        )
      );
    }

    // EDGE003: top-level process.env reads
    const topLevelEnvRegex = /^(?:export\s+)?const\s+\w+\s*=\s*process\.env\.\w+/gm;
    while ((m = topLevelEnvRegex.exec(content))) {
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      if (this.isSuppressed(lines, lineIndex, 'EDGE003')) continue;
      const meta = getRule('EDGE003')?.meta;
      if (!meta) continue;
      out.push(
        this.createResult(
          {
            type: 'warning',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
            confidence: 0.7,
            confidenceReason:
              'process.env access at module scope inside an edge route — value is frozen at build time.'
          },
          lines[lineIndex]
        )
      );
    }

    // EDGE002: long-lived OpenAI/Anthropic call without streaming
    const longCallRegex =
      /\b(?:chat\.completions\.create|messages\.create|generateText|generateObject)\s*\(\s*\{[^}]{0,400}\bstream\s*:\s*false/;
    if (longCallRegex.test(content) || (/\b(?:chat\.completions\.create|messages\.create|generateText)\s*\(/.test(content) && !/\bstream\s*:\s*true/.test(content))) {
      const idx = lines.findIndex((l) => /\b(?:chat\.completions\.create|messages\.create|generateText|generateObject)\s*\(/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'EDGE002')) {
        const meta = getRule('EDGE002')?.meta;
        if (meta) {
          out.push(
            this.createResult(
              {
                type: 'warning',
                category: 'security',
                severity: meta.severity,
                ruleId: meta.id,
                message: meta.message,
                fix: meta.fix,
                file,
                line: idx + 1,
                match: redact((lines[idx] ?? '').trim().slice(0, 200)),
                confidence: 0.6,
                confidenceReason:
                  'Edge route makes a non-streaming LLM call; risks hitting the 25–30s edge wall-clock cap.'
              },
              lines[idx]
            )
          );
        }
      }
    }

    return out;
  }

  // -------- SvelteKit (SVELTE001–002) ----------------------------------

  private detectSvelteKit(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    const isPageServer = /\.(?:server)\.(?:ts|js)$/.test(file) || /\+page\.server\.(?:ts|js)$/.test(file);
    if (!isPageServer) return out;

    // SVELTE001: load() returning env-derived secrets
    const meta1 = getRule('SVELTE001')?.meta;
    if (meta1 && /export\s+const\s+load\b/.test(content) && /process\.env\.[A-Z0-9_]+|env\.[A-Z0-9_]+/.test(content)) {
      const idx = lines.findIndex((l) => /process\.env\.[A-Z0-9_]+|env\.[A-Z0-9_]+/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'SVELTE001')) {
        out.push(
          this.createResult(
            {
              type: 'warning',
              category: 'security',
              severity: meta1.severity,
              ruleId: meta1.id,
              message: meta1.message,
              fix: meta1.fix,
              file,
              line: idx + 1,
              match: redact((lines[idx] ?? '').trim().slice(0, 200)),
              confidence: 0.5,
              confidenceReason: 'Server load() touches env vars and may serialise them into the page payload.'
            },
            lines[idx]
          )
        );
      }
    }

    // SVELTE002: form actions without auth
    const meta2 = getRule('SVELTE002')?.meta;
    if (meta2 && /export\s+const\s+actions\s*[:=]/.test(content) && !this.authMarkerRegex.test(content)) {
      const idx = lines.findIndex((l) => /export\s+const\s+actions\s*[:=]/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'SVELTE002')) {
        out.push(
          this.createResult(
            {
              type: 'warning',
              category: 'security',
              severity: meta2.severity,
              ruleId: meta2.id,
              message: meta2.message,
              fix: meta2.fix,
              file,
              line: idx + 1,
              match: redact((lines[idx] ?? '').trim().slice(0, 200)),
              confidence: 0.6,
              confidenceReason: 'SvelteKit form actions defined without an auth marker in the same module.'
            },
            lines[idx]
          )
        );
      }
    }

    return out;
  }

  // -------- Astro endpoints (ASTRO001) ---------------------------------

  private detectAstroEndpoints(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    const looksLikeEndpoint =
      /\b(GET|POST|PUT|PATCH|DELETE)\s*:\s*(?:async\s*)?\(?\s*\{?[^)]*Astro[^)]*\}?\)?\s*=>/.test(content) ||
      /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\s*\(/.test(content) ||
      /export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\s*:\s*APIRoute\b/.test(content) ||
      /from\s+['"]astro['"]/.test(content);
    if (!looksLikeEndpoint) return out;
    // Only Astro projects: must import from 'astro' or have `.astro` neighbours.
    if (!/from\s+['"]astro(?:\:|['"])/.test(content) && !/APIRoute\b/.test(content)) return out;

    // Only flag mutating verbs
    const meta = getRule('ASTRO001')?.meta;
    if (!meta) return out;
    if (this.authMarkerRegex.test(content)) return out;
    const mutateRegex = /\bexport\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\s*\(|\b(POST|PUT|PATCH|DELETE)\s*:/;
    const mm = mutateRegex.exec(content);
    if (!mm) return out;
    const idx = content.slice(0, mm.index).split('\n').length - 1;
    if (this.isSuppressed(lines, idx, 'ASTRO001')) return out;
    out.push(
      this.createResult(
        {
          type: 'error',
          category: 'security',
          severity: meta.severity,
          ruleId: meta.id,
          message: meta.message,
          fix: meta.fix,
          file,
          line: idx + 1,
          match: redact((lines[idx] ?? '').trim().slice(0, 200)),
          confidence: 0.55,
          confidenceReason: 'Astro endpoint defines a mutating verb without an auth marker.'
        },
        lines[idx]
      )
    );
    return out;
  }

  // -------- Remix (REMIX001) -------------------------------------------

  private detectRemix(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    if (!/\b(?:LoaderFunctionArgs|ActionFunctionArgs|loader|action)\b/.test(content)) return out;
    if (!/from\s+['"]@remix-run\/(?:node|cloudflare|server-runtime)['"]/.test(content)) return out;
    if (this.authMarkerRegex.test(content)) return out;
    const dbSink = /\b(?:prisma|drizzle|db\.|supabase\.from\(|knex\(|sequelize\.|mongoose\.)/.test(content);
    if (!dbSink) return out;
    const meta = getRule('REMIX001')?.meta;
    if (!meta) return out;

    const idx = lines.findIndex((l) => /\bexport\s+(?:async\s+)?(?:const|function)\s+(?:loader|action)\b/.test(l));
    if (idx < 0 || this.isSuppressed(lines, idx, 'REMIX001')) return out;
    out.push(
      this.createResult(
        {
          type: 'error',
          category: 'security',
          severity: meta.severity,
          ruleId: meta.id,
          message: meta.message,
          fix: meta.fix,
          file,
          line: idx + 1,
          match: redact((lines[idx] ?? '').trim().slice(0, 200)),
          confidence: 0.6,
          confidenceReason:
            'Remix loader/action touches a DB client (prisma/drizzle/supabase) but lacks an auth marker.'
        },
        lines[idx]
      )
    );
    return out;
  }

  // -------- Hono (HONO001) ---------------------------------------------

  private detectHono(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    if (!/from\s+['"]hono(?:\/[^'"`]+)?['"]/.test(content)) return out;
    if (/\bzValidator\s*\(/.test(content)) return out;
    const meta = getRule('HONO001')?.meta;
    if (!meta) return out;

    const bodyReadRegex = /\bc\.req\.(?:json|formData|parseBody)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = bodyReadRegex.exec(content))) {
      const idx = content.slice(0, m.index).split('\n').length - 1;
      if (this.isSuppressed(lines, idx, 'HONO001')) continue;
      out.push(
        this.createResult(
          {
            type: 'warning',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: meta.message,
            fix: meta.fix,
            file,
            line: idx + 1,
            match: redact((lines[idx] ?? '').trim().slice(0, 200)),
            confidence: 0.65,
            confidenceReason: 'Hono route reads request body but no zValidator middleware is in scope.'
          },
          lines[idx]
        )
      );
    }
    return out;
  }

  // -------- Drizzle / Prisma (DRIZZLE001 / PRISMA001) ------------------

  private detectDrizzlePrisma(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];

    // DRIZZLE001: sql`... ${user} ...` interpolation
    const drizzleMeta = getRule('DRIZZLE001')?.meta;
    if (drizzleMeta && /from\s+['"]drizzle-orm['"]/.test(content)) {
      const sqlRegex = /\bsql\s*`[^`]*\$\{[^}]*\b(?:req\.|input|body|params|searchParams|userInput|formData)[^}]*\}[^`]*`/g;
      let m: RegExpExecArray | null;
      while ((m = sqlRegex.exec(content))) {
        const idx = content.slice(0, m.index).split('\n').length - 1;
        if (this.isSuppressed(lines, idx, 'DRIZZLE001')) continue;
        out.push(
          this.createResult(
            {
              type: 'error',
              category: 'security',
              severity: drizzleMeta.severity,
              ruleId: drizzleMeta.id,
              message: drizzleMeta.message,
              fix: drizzleMeta.fix,
              file,
              line: idx + 1,
              match: redact((lines[idx] ?? '').trim().slice(0, 200)),
              confidence: 0.85,
              confidenceReason: 'Drizzle sql`` template interpolates user-controlled input directly.'
            },
            lines[idx]
          )
        );
      }
    }

    // PRISMA001: $queryRawUnsafe / $executeRawUnsafe with non-literal arg
    const prismaMeta = getRule('PRISMA001')?.meta;
    if (prismaMeta && /\$(?:queryRaw|executeRaw)Unsafe\s*\(/.test(content)) {
      const idx = lines.findIndex((l) => /\$(?:queryRaw|executeRaw)Unsafe\s*\(/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'PRISMA001')) {
        out.push(
          this.createResult(
            {
              type: 'error',
              category: 'security',
              severity: prismaMeta.severity,
              ruleId: prismaMeta.id,
              message: prismaMeta.message,
              fix: prismaMeta.fix,
              file,
              line: idx + 1,
              match: redact((lines[idx] ?? '').trim().slice(0, 200)),
              confidence: 0.85,
              confidenceReason: 'Prisma $queryRawUnsafe/$executeRawUnsafe is a documented SQL injection sink.'
            },
            lines[idx]
          )
        );
      }
    }

    return out;
  }

  // -------- NEXT216: Next 15 async params / searchParams ----------------

  private detectNext15AsyncParams(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Only App Router page/layout/route files care.
    if (!/(?:^|\/)app\/.*\/(?:page|layout|route|default|template|error|not-found|loading)\.(?:tsx|ts)$/.test(file)
        && !/(?:^|\/)app\/(?:page|layout|route)\.(?:tsx|ts)$/.test(file)) {
      return out;
    }
    const meta = getRule('NEXT216')?.meta;
    if (!meta) return out;

    // Match `params:` or `searchParams:` inside a prop type block where the value
    // is a plain object literal (`{ ... }`) rather than `Promise<...>`.
    const propRegex = /\b(params|searchParams)\s*:\s*([^,;}\n]+)/g;
    const seen = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = propRegex.exec(content))) {
      const rawType = (m[2] || '').trim();
      if (!rawType) continue;
      // Accept: `Promise<…>`, `Awaitable<…>`, or imported alias ending in `Params`
      // that the user obviously owns. We only fire on bare object literal or
      // `Record<…>` / indexed access types without `Promise`.
      if (/^Promise\s*</.test(rawType)) continue;
      if (!/^\{/.test(rawType) && !/^Record\s*</.test(rawType) && !/^\[/.test(rawType)) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      if (seen.has(lineIndex)) continue;
      seen.add(lineIndex);
      if (this.isSuppressed(lines, lineIndex, 'NEXT216')) continue;
      out.push(
        this.createResult(
          {
            type: 'warning',
            category: 'security',
            severity: meta.severity,
            ruleId: meta.id,
            message: `${meta.message} (${m[1]})`,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
            confidence: 0.8,
            confidenceReason: `App Router ${file} types \`${m[1]}\` as a plain object — Next 15 passes a Promise here.`
          },
          lines[lineIndex]
        )
      );
    }
    return out;
  }

  // -------- NEXT217: hooks without 'use client' -------------------------

  private detectMissingUseClient(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    if (!/\.(?:tsx|jsx)$/.test(file)) return out;
    const meta = getRule('NEXT217')?.meta;
    if (!meta) return out;

    // Strip leading comments/blank lines to find the first directive
    const firstNonBlank = lines.findIndex((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return false;
      return true;
    });
    const directive = firstNonBlank >= 0 ? lines[firstNonBlank].trim() : '';
    if (/^['"]use client['"]\s*;?$/.test(directive)) return out;

    // Look for hook imports from react: `import { useState, useEffect } from 'react'`
    const importRegex = /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"]react['"]/g;
    const hooks: Array<{ name: string; line: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(content))) {
      const names = (m[1] || '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const hook = names.find((n) => /^use[A-Z]\w*$/.test(n));
      if (!hook) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      hooks.push({ name: hook, line: lineIndex });
    }
    if (hooks.length === 0) return out;
    const first = hooks[0];
    if (this.isSuppressed(lines, first.line, 'NEXT217')) return out;
    out.push(
      this.createResult(
        {
          type: 'error',
          category: 'security',
          severity: meta.severity,
          ruleId: meta.id,
          message: `${meta.message} (imports \`${first.name}\`)`,
          fix: meta.fix,
          file,
          line: first.line + 1,
          match: redact((lines[first.line] ?? '').trim().slice(0, 200)),
          confidence: 0.9,
          confidenceReason: `File imports the hook \`${first.name}\` from 'react' but has no top-of-file \`'use client'\` directive.`
        },
        lines[first.line]
      )
    );
    return out;
  }

  // -------- NEXT218 / NEXT219: next.config hints ------------------------

  private detectNextConfigHints(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    if (!/(?:^|\/)next\.config\.(?:js|ts|mjs|cjs)$/.test(file)) return out;

    const meta218 = getRule('NEXT218')?.meta;
    if (meta218) {
      const idx = lines.findIndex((l) => /\breactStrictMode\s*:\s*false\b/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'NEXT218')) {
        out.push(
          this.createResult(
            {
              type: 'warning',
              category: 'security',
              severity: meta218.severity,
              ruleId: meta218.id,
              message: meta218.message,
              fix: meta218.fix,
              file,
              line: idx + 1,
              match: redact((lines[idx] ?? '').trim().slice(0, 200)),
              confidence: 0.95,
              confidenceReason: '`reactStrictMode: false` literal in next.config.'
            },
            lines[idx]
          )
        );
      }
    }

    const meta219 = getRule('NEXT219')?.meta;
    if (meta219) {
      const idx = lines.findIndex((l) => /\bserverActions\s*:\s*(?:true|false)\b/.test(l));
      if (idx >= 0 && !this.isSuppressed(lines, idx, 'NEXT219')) {
        out.push(
          this.createResult(
            {
              type: 'warning',
              category: 'security',
              severity: meta219.severity,
              ruleId: meta219.id,
              message: meta219.message,
              fix: meta219.fix,
              file,
              line: idx + 1,
              match: redact((lines[idx] ?? '').trim().slice(0, 200)),
              confidence: 0.9,
              confidenceReason: 'experimental.serverActions uses the removed boolean shape.'
            },
            lines[idx]
          )
        );
      }
    }

    return out;
  }

  // -------- NEXT220-225: App Router boundary hygiene --------------------

  private detectNextAppRouterBoundaries(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    if (!/\.(?:tsx|jsx|ts)$/.test(file)) return out;

    // Figure out whether this file is a Client Component, a Server
    // Component, or an app-router route file.
    const firstNonBlank = lines.findIndex((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
    });
    const directive = firstNonBlank >= 0 ? lines[firstNonBlank].trim() : '';
    const isClient = /^['"]use client['"]\s*;?$/.test(directive);
    const inAppDir = /(?:^|\/)app\//.test(file);

    const pushFinding = (ruleId: string, lineIndex: number, confidence: number, reason: string, detail?: string): void => {
      if (this.isSuppressed(lines, lineIndex, ruleId)) return;
      const meta = getRule(ruleId)?.meta;
      if (!meta) return;
      out.push(
        this.createResult(
          {
            type: meta.severity === 'high' ? 'error' : 'warning',
            category: meta.category,
            severity: meta.severity,
            ruleId: meta.id,
            message: detail ? `${meta.message} — ${detail}` : meta.message,
            fix: meta.fix,
            file,
            line: lineIndex + 1,
            match: redact((lines[lineIndex] ?? '').trim().slice(0, 200)),
            confidence,
            confidenceReason: reason
          },
          lines[lineIndex]
        )
      );
    };

    // NEXT220: window / document access in a Server Component (app/**/*.tsx
    // without 'use client'). Match `window.` or `document.` read.
    if (inAppDir && !isClient && /\.(?:tsx|jsx)$/.test(file)) {
      lines.forEach((line, i) => {
        if (/\btypeof\s+window\s*!==?\s*['"]undefined['"]/.test(line) ||
            /\bwindow\.[A-Za-z_$]/.test(line) ||
            /\bdocument\.[A-Za-z_$]/.test(line)) {
          pushFinding('NEXT220', i, 0.75,
            'Browser global referenced in a Server Component (no `use client` directive).'
          );
        }
      });
    }

    // NEXT221: Client Component imports a server-only module.
    if (isClient) {
      const serverOnly = [
        'fs', 'fs/promises', 'child_process', 'net', 'dgram', 'dns',
        'better-sqlite3', 'pg', 'mysql2', 'mongodb', 'redis', 'ioredis',
        '@prisma/client', 'prisma', 'drizzle-orm/node-postgres',
        'drizzle-orm/better-sqlite3', 'drizzle-orm/mysql2'
      ];
      const importRegex = /import\s+(?:[^'"`]+?\s+from\s+)?['"]([^'"`]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(content))) {
        const spec = m[1];
        if (serverOnly.includes(spec) || serverOnly.some((s) => spec.startsWith(`${s}/`))) {
          const lineIndex = content.slice(0, m.index).split('\n').length - 1;
          pushFinding('NEXT221', lineIndex, 0.9,
            `Client component imports \`${spec}\`, a server-only module.`,
            `imports \`${spec}\``
          );
        }
      }
    }

    // NEXT222: Server Component imports a client-only state library.
    if (inAppDir && !isClient && /\.(?:tsx|jsx)$/.test(file)) {
      const clientOnly = ['zustand', 'jotai', 'recoil', 'valtio', 'mobx'];
      const importRegex = /import\s+(?:[^'"`]+?\s+from\s+)?['"]([^'"`]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(content))) {
        const spec = m[1];
        const top = spec.split('/')[0];
        if (clientOnly.includes(top)) {
          const lineIndex = content.slice(0, m.index).split('\n').length - 1;
          pushFinding('NEXT222', lineIndex, 0.8,
            `Server Component imports \`${spec}\` (client-only state library).`,
            `imports \`${spec}\``
          );
        }
      }
    }

    // NEXT223: route.ts uses `export default`.
    if (/(?:^|\/)app\/.*\/route\.(?:ts|tsx)$/.test(file) || /(?:^|\/)app\/route\.(?:ts|tsx)$/.test(file)) {
      const idx = lines.findIndex((l) => /^\s*export\s+default\b/.test(l));
      if (idx >= 0) {
        pushFinding('NEXT223', idx, 0.95,
          'Route file uses `export default`; Next ignores defaults in route handlers.'
        );
      }
    }

    // NEXT224: <a href="/internal"> in a page/component.
    if (/\.(?:tsx|jsx)$/.test(file)) {
      const aRegex = /<a\b([^>]*?)\bhref\s*=\s*["']\/[^"'#?]*["']([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = aRegex.exec(content))) {
        const attrs = `${m[1]} ${m[2]}`;
        if (/\btarget\s*=\s*["']_blank["']/.test(attrs)) continue; // external-ish new tab
        if (/\bdownload\b/.test(attrs)) continue;
        const lineIndex = content.slice(0, m.index).split('\n').length - 1;
        pushFinding('NEXT224', lineIndex, 0.7,
          'Internal anchor used; prefer `next/link` for client navigation.'
        );
      }
    }

    // NEXT225: <form method="POST" action="/api/..."> without Server Action.
    if (/\.(?:tsx|jsx)$/.test(file)) {
      const formRegex = /<form\b([^>]*)>/gi;
      let m: RegExpExecArray | null;
      while ((m = formRegex.exec(content))) {
        const attrs = m[1];
        const isPost = /\bmethod\s*=\s*["']post["']/i.test(attrs);
        const actionMatch = /\baction\s*=\s*["']([^"']+)["']/i.exec(attrs);
        const actionExpr = /\baction\s*=\s*\{[^}]+\}/.test(attrs);
        if (!isPost || !actionMatch) continue;
        const action = actionMatch[1];
        if (!action.startsWith('/')) continue;
        // Using a Server Action via action={fn} is OK; flag only string actions.
        if (actionExpr) continue;
        const lineIndex = content.slice(0, m.index).split('\n').length - 1;
        pushFinding('NEXT225', lineIndex, 0.7,
          'POST form targets a URL string without a Server Action wrapper or visible CSRF guard.'
        );
      }
    }

    return out;
  }
}
