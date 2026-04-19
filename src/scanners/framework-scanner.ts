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

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    this.initCache(options, 'framework:1');

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

      this.setCached(ctx.file, ctx.contentHash, fileResults);
      results.push(...fileResults);
    }

    this.saveCache();
    return results;
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
      /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\s*\(/.test(content);
    if (!looksLikeEndpoint) return out;

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
}
