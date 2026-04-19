import { glob } from 'glob';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Scanner, ScanResult, ScanOptions } from '../types';
import { RULES, getRule } from '../rules';
import { extractQuotedLiterals, shannonEntropy } from '../utils/entropy';
import { ResultCache } from '../utils/result-cache';
import { FileSourceCache, DEFAULT_MAX_FILE_SIZE } from '../utils/file-source-cache';

export class SecurityScanner implements Scanner {
  name = 'Security Scanner';

  // Rule IDs that have been migrated to modular rules with patterns
  private readonly modularRuleIds = [
    'SEC001', 'SEC002', 'SEC003', 'SEC004', 'SEC005', 'SEC006', 'SEC007',
    'SEC008', 'SEC009', 'SEC010', 'SEC011', 'SEC012', 'SEC013', 'SEC014',
    'SEC015', 'SEC016', 'SEC017',
    'AI001', 'AI004'
  ];

  // Confidence reasons for each rule
  private readonly confidenceReasons: Record<string, string> = {
    'SEC001': 'Pattern matches known API key prefixes (sk-, pk_test_, etc.)',
    'SEC002': 'URL matches Supabase project pattern',
    'SEC003': 'String matches JWT token structure (three base64 segments)',
    'SEC004': 'Pattern matches Firebase config keys',
    'SEC005': 'Pattern matches Stripe key prefixes',
    'SEC006': 'Variable name contains "password" with non-empty string value',
    'SEC007': 'Pattern matches private key header',
    'SEC008': 'Environment variable with hardcoded fallback string',
    'SEC009': 'Pattern matches AWS Access Key ID format (AKIA...)',
    'SEC010': 'Pattern matches Slack webhook URL structure',
    'SEC011': 'Pattern matches GitHub token prefixes (ghp_, gho_, etc.)',
    'SEC012': 'Pattern matches Twilio Account SID format',
    'SEC013': 'Pattern matches SendGrid API key format',
    'SEC014': 'Pattern matches OpenAI API key format (sk-...)',
    'SEC015': 'Console statement detected in production code',
    'SEC016': 'Direct eval() call detected - code execution risk',
    'SEC017': 'dangerouslySetInnerHTML usage - XSS risk if content unsanitized',
    'SEC018': 'High Shannon entropy suggests random/secret data',
    'NEXT201': 'Missing 404/not-found page in Next.js app',
    'NEXT202': 'Missing error boundary in Next.js app',
    'JSNET001': 'HTTP request without timeout can hang indefinitely',
    'COOKIE001': 'Cookie missing security attributes (HttpOnly, Secure, SameSite)',
    'AI001': 'String matches an LLM provider key prefix (sk-, sk-ant-, AIza, gsk_, r8_, etc.)',
    'AI004': 'String matches a known vector DB credential format (Pinecone, Qdrant, Weaviate)'
  };

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    const files = await glob('**/*.{js,jsx,ts,tsx,svelte,astro,env}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });
    const signature = `sec:2:profile:${options.profile || 'auto'}`;
    const resultCache = options.noResultCache ? null : new ResultCache(options.directory, signature);
    let processed = 0;

    // Load modular rules
    const modularRules = this.modularRuleIds.map(id => getRule(id)).filter(Boolean);

    // NEXT* rules gate: require a real Next.js project so an Astro fixture
    // with `src/pages/api/*` doesn't spuriously flag NEXT209.
    const isNextProject = ((): boolean => {
      try {
        const pkgPath = join(options.directory, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          if (pkg.dependencies?.next || pkg.devDependencies?.next) return true;
        }
      } catch {}
      return (
        existsSync(join(options.directory, 'next.config.js')) ||
        existsSync(join(options.directory, 'next.config.ts')) ||
        existsSync(join(options.directory, 'next.config.mjs')) ||
        existsSync(join(options.directory, 'next.config.cjs'))
      );
    })();

    // Project-level Next.js structure presence flags (for P5 experimental rules)
    const hasAppDir = files.some(f => /^app\//.test(f));
    const hasPagesDir = files.some(f => /^pages\//.test(f));
    const hasNotFoundApp = files.some(f => /^app\/not-found\.(js|jsx|ts|tsx)$/.test(f));
    const has404Pages = files.some(f => /^pages\/404\.(js|jsx|ts|tsx)$/.test(f));
    const hasErrorApp = files.some(f => /^app\/error\.(js|jsx|ts|tsx)$/.test(f));
    const hasErrorPages = files.some(f => /^pages\/_error\.(js|jsx|ts|tsx)$/.test(f));
    const hasDocumentPages = files.some(f => /^pages\/_document\.(js|jsx|ts|tsx)$/.test(f));
    // Emit-once sentinels
    let emittedP5_404 = false;
    let emittedP5_error = false;
    let emittedP5_document = false;

    const sourceCache = FileSourceCache.forDirectory(options.directory);
    const maxSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    for (const file of files) {
      try {
        const absolute = join(options.directory, file);
        try {
          if (statSync(absolute).size > maxSize) continue;
        } catch {
          continue;
        }
        const content = sourceCache.read(absolute);
        if (content === undefined) continue;
        const contentHash = ResultCache.hashContent(content);
        const cached = resultCache?.get(file, contentHash);
        if (cached) {
          results.push(...cached);
          processed++;
          if (options.verbose && processed % 25 === 0) {
            console.log('🪷', `Scanning... (${processed}/${files.length} files)`);
          }
          continue;
        }
        const lines = content.split('\n');
        processed++;
        if (options.verbose && processed % 25 === 0) {
          console.log('🪷', `Scanning... (${processed}/${files.length} files)`);
        }
        const fileExt = file.split('.').pop()?.toLowerCase() || '';

        let ubonDisableAll = false;
        lines.forEach((line) => {
          if (/ubon-disable-file/.test(line)) { ubonDisableAll = true; }
        });
        if (ubonDisableAll) continue;

        // Run modular rules with patterns
        for (const rule of modularRules) {
          if (!rule) continue;
          if (rule.impl.fileTypes && !rule.impl.fileTypes.includes(fileExt)) continue;
          if (rule.impl.skipPatterns?.some(p => p.test(file))) continue;

          if (rule.impl.patterns) {
            for (const pattern of rule.impl.patterns) {
              lines.forEach((line, index) => {
                // Skip comments and pattern definitions
                if (line.trim().startsWith('//') || 
                    line.trim().startsWith('*') ||
                    line.includes('pattern:') ||
                    line.includes('message:') ||
                    line.includes('severity:') ||
                    line.includes('fix:') ||
                    file.includes('security-scanner.ts') ||
                    file.includes('/rules/security/')) {
                  return;
                }

                // Skip console logs in logger files (intentional)
                if (pattern.ruleId === 'SEC015' && file.includes('logger')) {
                  return;
                }

                // Check inline suppressions
                const disableNext = /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(line);
                const prevDisable = index > 0 ? /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[index - 1]) : null;
                const disabledList = new Set<string>([
                  ...(disableNext && disableNext[1] ? disableNext[1].split(/[,\s]+/).filter(Boolean) : []),
                  ...(prevDisable && prevDisable[1] ? prevDisable[1].split(/[,\s]+/).filter(Boolean) : [])
                ]);
                if (disabledList.has(pattern.ruleId)) return;

                const m = line.match(pattern.pattern);
                if (m) {
                  const fixEdits: any[] = [];
                  
                  // Auto-fix for SEC008: Remove hardcoded fallback
                  if (pattern.ruleId === 'SEC008') {
                    const replacement = line.replace(/(process\.env\.\w+)\s*\|\|\s*['"][^'"`]+['"]/g, '$1');
                    if (replacement !== line) {
                      fixEdits.push({
                        file,
                        startLine: index + 1,
                        startColumn: 1,
                        endLine: index + 1,
                        endColumn: Math.max(1, line.length),
                        replacement
                      });
                    }
                  }
                  
                  // Auto-fix for SEC015: Remove console statement
                  if (pattern.ruleId === 'SEC015') {
                    fixEdits.push({
                      file,
                      startLine: index + 1,
                      startColumn: 1,
                      endLine: index + 1,
                      endColumn: Math.max(1, line.length),
                      replacement: ''
                    });
                  }

                  results.push({
                    type: pattern.severity === 'high' ? 'error' : 'warning',
                    category: 'security',
                    message: pattern.message,
                    file,
                    line: index + 1,
                    range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                    match: m[0]?.slice(0, 200),
                    severity: pattern.severity,
                    ruleId: pattern.ruleId,
                    confidence: pattern.confidence,
                    confidenceReason: this.confidenceReasons[pattern.ruleId] || 'Pattern match detected',
                    fix: pattern.fix,
                    ...(fixEdits.length ? { fixEdits } : {})
                  });
                }
              });
            }
          }
        }

        // Project-level Next.js structure checks (emit once per project).
        // Gate on real Next.js: Remix also uses `app/` and we don't want to
        // flag a missing `app/not-found.tsx` in a Remix project.
        if (isNextProject && /^(pages|app)\//.test(file)) {
          // Missing not-found/404
          if (!emittedP5_404) {
            if (hasAppDir && !hasNotFoundApp) {
              const meta = RULES.NEXT201;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, confidenceReason: this.confidenceReasons['NEXT201'], fix: meta.fix });
              emittedP5_404 = true;
            } else if (hasPagesDir && !has404Pages) {
              const meta = RULES.NEXT201;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, confidenceReason: this.confidenceReasons['NEXT201'], fix: meta.fix });
              emittedP5_404 = true;
            }
          }
          // Missing error boundary
          if (!emittedP5_error) {
            if (hasAppDir && !hasErrorApp) {
              const meta = RULES.NEXT202;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, confidenceReason: this.confidenceReasons['NEXT202'], fix: meta.fix });
              emittedP5_error = true;
            } else if (hasPagesDir && !hasErrorPages) {
              const meta = RULES.NEXT202;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, confidenceReason: this.confidenceReasons['NEXT202'], fix: meta.fix });
              emittedP5_error = true;
            }
          }
          // _document for Pages Router only when code hints custom head/script usage
          if (!emittedP5_document && hasPagesDir && /from\s+['"]next\/(head|script)['"]/.test(content) && !hasDocumentPages) {
            const meta = RULES.NEXT203;
            results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, confidenceReason: 'Custom head/script usage detected without _document.tsx', fix: meta.fix });
            emittedP5_document = true;
          }
        }

        // JS HTTP timeout/retry policy checks
        lines.forEach((line, index) => {
          // axios without timeout
          if (/axios\.(get|post|put|delete|patch)\(/i.test(line) && !/timeout\s*:/i.test(line)) {
            const meta = RULES.JSNET001;
            results.push({
              type: meta.severity === 'high' ? 'error' : 'warning',
              category: meta.category,
              message: meta.message,
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              match: line.slice(0, 200),
              confidence: 0.7,
              confidenceReason: 'axios call without timeout option - requests can hang indefinitely',
              fix: meta.fix
            });
          }
          // fetch without AbortController/timeout wrappers (heuristic)
          if (/\bfetch\s*\(/.test(line) && !/AbortController|signal\s*:/.test(line)) {
            const meta = RULES.JSNET001;
            const suggested = line.replace(/fetch\(([^)]*)\)/, 'fetch($1, { signal })');
            const fixEdits = [{
              file,
              startLine: index + 1,
              startColumn: 1,
              endLine: index + 1,
              endColumn: Math.max(1, line.length),
              replacement: suggested
            }];
            results.push({
              type: meta.severity === 'high' ? 'error' : 'warning',
              category: meta.category,
              message: meta.message,
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              match: line.slice(0, 200),
              confidence: 0.6,
              confidenceReason: 'fetch() without AbortController signal - lower confidence as signal may be added elsewhere',
              fix: 'Use AbortController with a timeout to cancel long fetches',
              fixEdits
            });
          }
          // Set-Cookie missing attributes (with fix edits)
          if (/setHeader\(\s*['"][Ss]et-[Cc]ookie['"],\s*['"][^'"]+['"]\s*\)/.test(line) || /Set-Cookie:/i.test(line)) {
            const cookieStrMatch = line.match(/Set-Cookie:\s*([^;]+(?:;[^;]+)*)/i);
            const cookieStr = cookieStrMatch ? cookieStrMatch[1] : line;
            const hasHttpOnly = /HttpOnly/i.test(cookieStr);
            const hasSecure = /Secure/i.test(cookieStr);
            const hasSameSite = /SameSite/i.test(cookieStr);
            if (!(hasHttpOnly && hasSecure && hasSameSite)) {
              const meta = RULES.COOKIE001;
              const needed = `${hasHttpOnly ? '' : '; HttpOnly'}${hasSecure ? '' : '; Secure'}${hasSameSite ? '' : '; SameSite=Lax'}`;
              const fixedLine = line.replace(/(['"])\s*\)\s*;?$/, `${needed}$1)`);
              const fixEdits = [{
                file,
                startLine: index + 1,
                startColumn: 1,
                endLine: index + 1,
                endColumn: Math.max(1, line.length),
                replacement: fixedLine
              }];
              results.push({
                type: meta.severity === 'high' ? 'error' : 'warning',
                category: meta.category,
                message: meta.message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                severity: meta.severity,
                ruleId: meta.id,
                match: line.slice(0, 200),
                confidence: 0.8,
                confidenceReason: this.confidenceReasons['COOKIE001'],
                fix: meta.fix,
                fixEdits
              });
            }
          }
        });

        // Entropy-based secret detection (context-aware, reduced noise)
        lines.forEach((line, index) => {
          const toks = extractQuotedLiterals(line).filter(s => s.length >= 16);
          for (const tok of toks) {
            const ent = shannonEntropy(tok);
            if (ent < 3.8 || !/[A-Za-z0-9]/.test(tok)) continue;

            // File/context-based ignores: CSS/Tailwind, configs, globs
            const lowerFile = file.toLowerCase();
            const isCssContext = lowerFile.endsWith('.css') || lowerFile.endsWith('.scss') || lowerFile.endsWith('.sass') || lowerFile.endsWith('.less') || lowerFile.includes('tailwind.config');
            if (isCssContext) continue;

            // Token-based ignores: hex colors, tailwind classes, data URIs, globs, UUIDs
            const isHexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(tok);
            const isTailwind = /(bg|text|border|from|to|via)-[a-zA-Z]+-\d{2,3}/.test(tok);
            const isDataUri = /^data:image\//.test(tok);
            const isGlobLike = /\*\*?|\{.*\}|\*\.[a-zA-Z0-9]+/.test(tok);
            const isUuid = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/.test(tok);
            if (isHexColor || isTailwind || isDataUri || isGlobLike || isUuid) continue;

            // Suspicious indicators increase confidence
            const looksLikeSecret = /\b(sk-|pk_live_|rk_(live|test)_|eyJ[A-Za-z0-9._-]{10,}|AKIA[0-9A-Z]{16}|password=|secret=|api_key=|token=|postgres(ql)?:\/\/|mongodb:\/\/)/.test(tok);
            const isDotEnvFile = /(^|\/)\.env(\.|$)/.test(lowerFile);
            if (!looksLikeSecret && !isDotEnvFile) continue;

            const meta = RULES.SEC018;
            const entropyConfidence = looksLikeSecret ? 0.9 : 0.8;
            results.push({
              type: meta.severity === 'high' ? 'error' : 'warning',
              category: meta.category,
              message: meta.message,
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              match: tok.slice(0, 200),
              confidence: entropyConfidence,
              confidenceReason: looksLikeSecret 
                ? 'High entropy + matches known secret pattern (sk-, AKIA, etc.)' 
                : 'High entropy string in .env file - likely a secret',
              fix: meta.fix
            });
          }
        });

        // Secret logging detection (console + secret-like token)
        lines.forEach((line, index) => {
          if (/console\.(log|debug|info|warn|error)\(/.test(line) && /(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16})/.test(line)) {
            const meta = RULES.LOG001;
            const fixEdits: any[] = [];
            // Replace logged secret literal with a redacted placeholder
            const redacted = line
              .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-********')
              .replace(/eyJ[A-Za-z0-9._-]{20,}/g, 'eyJ********')
              .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA**************');
            fixEdits.push({
              file,
              startLine: index + 1,
              startColumn: 1,
              endLine: index + 1,
              endColumn: Math.max(1, line.length),
              replacement: redacted
            });
            results.push({
              type: 'warning',
              category: meta.category,
              message: meta.message,
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.8,
              confidenceReason: 'Console statement contains string matching secret pattern',
              fix: meta.fix,
              fixEdits
            });
          }
        });

        // Next.js SSR secrets heuristic (legacy NEXT006)
        if (/get(ServerSideProps|StaticProps)\s*\(/.test(content) && /process\.env\./.test(content)) {
          const meta = RULES.NEXT006;
          results.push({ type: 'error', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.6, fix: meta.fix });
        }

        // Experimental P5: Server -> Client secret bleed (NEXT210)
        if (/\bexport\s+async\s+function\s+get(ServerSideProps|StaticProps)\b|\bexport\s+const\s+get(ServerSideProps|StaticProps)\b/.test(content)) {
          const readsSecret = /(process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+|secret|apiKey|token)/.test(content);
          // Bounded-greedy variant of the historical NEXT210 regex. The old
          // pattern (`[\s\S]*` between `props: {` and the sensitive
          // identifier) could backtrack catastrophically on adversarially
          // long single-line minified bundles. We cap to 2000 chars and use
          // a lazy quantifier — false negatives in pathological files are an
          // acceptable trade for a hard ReDoS ceiling.
          const returnsPropsWithSensitive =
            /return\s*\{\s*props\s*:\s*\{[\s\S]{0,2000}?\b(secret|token|apiKey|password|auth|key)\b/.test(content);
          if (readsSecret && returnsPropsWithSensitive) {
            const meta = RULES.NEXT210;
            results.push({ type: 'error', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.7, fix: meta.fix });
          }
        }

        // Next.js API route basic input validation heuristic
        if (/\b(pages|app)\/api\//.test(file)) {
          const hasValidatorImport = /from\s+['\"](zod|yup|ajv|valibot|superstruct|class-validator)['\"]/.test(content) || /import\s+\{?\s*(z|yup|Ajv|object|safeParse)/.test(content);
          let usesRequestParams = false;
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (/(req|request)\.(body|query|params)/.test(l)) { usesRequestParams = true; break; }
          }
          if (usesRequestParams && !hasValidatorImport) {
            const meta = RULES.NEXT003;
            results.push({
              type: 'warning',
              category: meta.category,
              message: meta.message,
              file,
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.6,
              fix: meta.fix
            });
          }
        }

        // Next.js specific JWT/Cookie security checks
        if (/\b(pages|app)\/api\//.test(file) || file.includes('middleware.ts')) {
          lines.forEach((line, index) => {
            // Check for JWT tokens in JSON responses (NEXT007)
            if (/res\.json\s*\(\s*\{[^}]*\b(token|jwt|accessToken|authToken)\s*:/.test(line)) {
              const meta = RULES.NEXT007;
              results.push({
                type: 'error',
                category: meta.category,
                message: meta.message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                severity: meta.severity,
                ruleId: meta.id,
                confidence: 0.9,
                fix: meta.fix
              });
            }

            // Check for unsafe redirects (NEXT009)
            if (/res\.redirect\s*\(\s*(req\.query\.|req\.body\.|req\.params\.)/.test(line)) {
              const meta = RULES.NEXT009;
              results.push({
                type: 'error',
                category: meta.category,
                message: meta.message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                severity: meta.severity,
                ruleId: meta.id,
                confidence: 0.8,
                fix: meta.fix
              });
            }

            // Check for permissive CORS (NEXT010)
            if (/Access-Control-Allow-Origin.*\*/.test(line) || /cors\s*\(\s*\{\s*origin:\s*['"`]\*['"`]/.test(line)) {
              const meta = RULES.NEXT010;
              results.push({
                type: 'warning',
                category: meta.category,
                message: meta.message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                severity: meta.severity,
                ruleId: meta.id,
                confidence: 0.7,
                fix: meta.fix
              });
            }

            // Check for environment variables leaked to client (NEXT011)
            if (/process\.env\.(?!NEXT_PUBLIC_)\w+/.test(line) && (file.includes('components/') || file.includes('pages/') && !file.includes('/api/') || file.includes('app/') && !file.includes('/api/'))) {
              const meta = RULES.NEXT011;
              results.push({
                type: 'error',
                category: meta.category,
                message: meta.message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                severity: meta.severity,
                ruleId: meta.id,
                confidence: 0.8,
                fix: meta.fix
              });
            }
          });

          // Check for missing security headers (NEXT008)
          const hasSecurityHeaders = /X-Content-Type-Options|X-Frame-Options|X-XSS-Protection|Strict-Transport-Security/.test(content);
          const setsHeaders = /res\.setHeader|headers\s*:\s*\{/.test(content);
          if (setsHeaders && !hasSecurityHeaders && !file.includes('_app.') && !file.includes('middleware.')) {
            const meta = RULES.NEXT008;
            results.push({
              type: 'warning',
              category: meta.category,
              message: meta.message,
              file,
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.6,
              fix: meta.fix
            });
          }
        }

        // API route structure: missing method validation (NEXT209) and unauthenticated sensitive responses (NEXT205)
        if (isNextProject && /\b(pages|app)\/api\//.test(file)) {
          const isPagesAPI = /\bpages\/api\//.test(file);
          const isAppRoute = /\bapp\/api\//.test(file);
          if (isPagesAPI) {
            const mentionsReqMethodCheck = /req\.method/.test(content) && /(GET|POST|PUT|DELETE|PATCH)/.test(content);
            if (!mentionsReqMethodCheck) {
              const meta = RULES.NEXT209;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.6, fix: meta.fix });
            }
          }
          if (isAppRoute) {
            const hasMethodExports = /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/.test(content);
            if (!hasMethodExports) {
              const meta = RULES.NEXT209;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.6, fix: meta.fix });
            }
          }
          // Unauthenticated API access heuristic: returns user/secrets without typical auth artifacts
          const returnsSensitive = /res\.(json|send)\(\s*\{[^}]*\b(user|email|token|secret|apiKey)\b/.test(content);
          const hasAuthSignals = /(getServerSession|next-auth|Authorization|getToken|cookies\(|jwt)/.test(content);
          if (returnsSensitive && !hasAuthSignals) {
            const meta = RULES.NEXT205;
            results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.6, fix: meta.fix });
          }
        }

        // Navigation: router.push with external URL (NEXT208)
        if (/useRouter\(\)/.test(content) || /from\s+['"]next\/navigation['"]/.test(content)) {
          lines.forEach((line, index) => {
            if (/router\.push\(\s*['"][a-z]+:\/\//i.test(line)) {
              const meta = RULES.NEXT208;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, line: index + 1, range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) }, severity: meta.severity, ruleId: meta.id, confidence: 0.7, fix: meta.fix });
            }
          });
        }

        // Check for insecure JWT cookies (COOKIE002) and propose fix edits
        lines.forEach((line, index) => {
          const isJwtCookie = /(Set-Cookie|setHeader\(\s*['"][Ss]et-[Cc]ookie['"])|setCookie\s*\(/.test(line) && /(jwt|token)=/i.test(line);
          const missingHttpOnly = !/HttpOnly/i.test(line);
          const missingSecure = !/Secure/i.test(line);
          if (isJwtCookie && (missingHttpOnly || missingSecure)) {
            const meta = RULES.COOKIE002;
            const addition = `${missingHttpOnly ? '; HttpOnly' : ''}${missingSecure ? '; Secure' : ''}`;
            const fixed = line.replace(/(['"])\s*\)\s*;?$/, `${addition}$1)`);
            const fixEdits = [{
              file,
              startLine: index + 1,
              startColumn: 1,
              endLine: index + 1,
              endColumn: Math.max(1, line.length),
              replacement: fixed
            }];
            results.push({
              type: 'error',
              category: meta.category,
              message: meta.message,
              file,
              line: index + 1,
              range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
              severity: meta.severity,
              ruleId: meta.id,
              confidence: 0.9,
              fix: meta.fix,
              fixEdits
            });
          }
        });

        // store per-file results for this file only
        const fileResults = results.filter(r => r.file === file);
        resultCache?.set(file, contentHash, fileResults);
      } catch (error) {
        if (options.verbose) {
          console.error(`🪷 SecurityScanner: failed to read ${file}:`, error);
        }
      }
    }
    resultCache?.save();
    return results;
  }
}
