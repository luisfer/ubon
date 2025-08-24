import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';
import { RULES } from '../types/rules';
import { extractQuotedLiterals, shannonEntropy } from '../utils/entropy';

export class SecurityScanner implements Scanner {
  name = 'Security Scanner';

  private readonly patterns = [
    // API Keys and Secrets
    {
      ruleId: 'SEC001',
      confidence: 0.9,
      pattern: /(['"`])(?:sk-|pk_test_|pk_live_|rk_live_|rk_test_).+?\1/gi,
      message: 'Potential API key or secret token exposed',
      severity: 'high' as const,
      fix: 'Move sensitive keys to environment variables'
    },
    // Supabase specific patterns
    {
      ruleId: 'SEC002',
      confidence: 0.8,
      pattern: /(['"`])https:\/\/[a-zA-Z0-9]+\.supabase\.co\1/gi,
      message: 'Supabase URL hardcoded (should use env var)',
      severity: 'medium' as const,
      fix: 'Use NEXT_PUBLIC_SUPABASE_URL environment variable'
    },
    {
      ruleId: 'SEC003',
      confidence: 0.95,
      pattern: /(['"`])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\1/gi,
      message: 'Supabase anon key hardcoded (JWT token pattern)',
      severity: 'high' as const,
      fix: 'Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable'
    },
    {
      ruleId: 'SEC004',
      confidence: 0.8,
      pattern: /supabaseUrl\s*[:=]\s*['"`][^'"`]+['"`]/gi,
      message: 'Supabase URL hardcoded in variable',
      severity: 'medium' as const,
      fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_URL'
    },
    {
      ruleId: 'SEC005',
      confidence: 0.9,
      pattern: /supabaseKey\s*[:=]\s*['"`][^'"`]+['"`]/gi,
      message: 'Supabase key hardcoded in variable',
      severity: 'high' as const,
      fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY'
    },
    // Database credentials
    {
      ruleId: 'SEC006',
      confidence: 0.85,
      pattern: /password\s*[:=]\s*['"`][^'"`]+['"`]/gi,
      message: 'Hardcoded password detected',
      severity: 'high' as const,
      fix: 'Use environment variables for passwords'
    },
    {
      ruleId: 'SEC007',
      confidence: 0.85,
      pattern: /DATABASE_URL\s*[:=]\s*['"`][^'"`]+['"`]/gi,
      message: 'Database URL hardcoded',
      severity: 'high' as const,
      fix: 'Use environment variable for database connection'
    },
    // Environment variable fallbacks
    {
      ruleId: 'SEC008',
      confidence: 0.75,
      pattern: /process\.env\.\w+\s*\|\|\s*['"`][^'"`]+['"`]/gi,
      message: 'Environment variable with hardcoded fallback',
      severity: 'medium' as const,
      fix: 'Remove hardcoded fallback values'
    },
    // Common service keys
    {
      ruleId: 'SEC009',
      confidence: 0.95,
      pattern: /(['"`])(?:AKIA[0-9A-Z]{16})\1/gi,
      message: 'AWS Access Key ID exposed',
      severity: 'high' as const,
      fix: 'Move AWS credentials to environment variables'
    },
    {
      ruleId: 'SEC010',
      confidence: 0.9,
      pattern: /(['"`])(?:ya29\.|1\/\/[0-9A-Za-z_-]+)\1/gi,
      message: 'Google OAuth token exposed',
      severity: 'high' as const,
      fix: 'Use secure token storage'
    },
    {
      ruleId: 'SEC011',
      confidence: 0.95,
      pattern: /(['"`])(?:gh[pousr]_[A-Za-z0-9_]{36,})\1/gi,
      message: 'GitHub token exposed',
      severity: 'high' as const,
      fix: 'Use environment variables for GitHub tokens'
    },
    // Stripe keys
    {
      ruleId: 'SEC012',
      confidence: 0.95,
      pattern: /(['"`])(?:sk_live_[a-zA-Z0-9]{99})\1/gi,
      message: 'Stripe live secret key exposed',
      severity: 'high' as const,
      fix: 'CRITICAL: Move Stripe live keys to secure environment'
    },
    {
      ruleId: 'SEC013',
      confidence: 0.9,
      pattern: /(['"`])(?:pk_live_[a-zA-Z0-9]{99})\1/gi,
      message: 'Stripe live publishable key exposed',
      severity: 'medium' as const,
      fix: 'Use environment variable for Stripe keys'
    },
    // OpenAI / AI service keys
    {
      ruleId: 'SEC014',
      confidence: 0.95,
      pattern: /(['"`])(?:sk-[a-zA-Z0-9]{48})\1/gi,
      message: 'OpenAI API key exposed',
      severity: 'high' as const,
      fix: 'Use OPENAI_API_KEY environment variable'
    },
    // Console logging
    {
      ruleId: 'SEC015',
      confidence: 0.6,
      pattern: /console\.(log|debug|info|warn|error)\(/gi,
      message: 'Console statement found (may leak sensitive info)',
      severity: 'low' as const,
      fix: 'Remove console statements before production'
    },
    // Security risks
    {
      ruleId: 'SEC016',
      confidence: 0.9,
      pattern: /eval\s*\(/gi,
      message: 'Use of eval() detected (security risk)',
      severity: 'high' as const,
      fix: 'Replace eval() with safer alternatives'
    },
    {
      ruleId: 'SEC017',
      confidence: 0.8,
      pattern: /dangerouslySetInnerHTML/gi,
      message: 'dangerouslySetInnerHTML usage (XSS risk)',
      severity: 'medium' as const,
      fix: 'Sanitize HTML content or use safer alternatives'
    }
  ];

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    const files = await glob('**/*.{js,jsx,ts,tsx,vue,env}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });
    let processed = 0;

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

    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const lines = content.split('\n');
        processed++;
        if (options.verbose && processed % 25 === 0) {
          // Periodic progress indicator for large repos
          console.log('🪷', `Scanning... (${processed}/${files.length} files)`);
        }
        const isAppRouter = /(^|\/)app\//.test(file) || hasAppDir;

        let ubonDisableAll = false;
        lines.forEach((line, index) => {
          // Inline suppressions
          if (/ubon-disable-file/.test(line)) { ubonDisableAll = true; }
          if (ubonDisableAll) return;
          const disableNext = /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(line);
          const prevDisable = index > 0 ? /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[index - 1]) : null;
          this.patterns.forEach((patternDef, patternIndex) => {
            const { pattern, message, severity, fix } = patternDef as any;
            const defaultConfidenceBySeverity: Record<'high' | 'medium' | 'low', number> = {
              high: 0.9,
              medium: 0.8,
              low: 0.6
            };
            const ruleId: string = (patternDef as any).ruleId || `SEC${String(patternIndex + 1).padStart(3, '0')}`;
            const sev: 'high' | 'medium' | 'low' = severity as 'high' | 'medium' | 'low';
            const confidence: number = (patternDef as any).confidence ?? defaultConfidenceBySeverity[sev];
            // Skip lines that are comments or inside pattern definitions
            if (line.trim().startsWith('//') || 
                line.trim().startsWith('*') ||
                line.includes('pattern:') ||
                line.includes('message:') ||
                line.includes('severity:') ||
                line.includes('fix:') ||
                file.includes('security-scanner.ts')) {
              return;
            }
            
            // Skip console logs in logger files (intentional)
            if (message.includes('Console statement') && file.includes('logger')) {
              return;
            }
            
            const m = line.match(pattern);
            if (m) {
              const disabledList = new Set<string>([
                ...(disableNext && disableNext[1] ? disableNext[1].split(/[,\s]+/).filter(Boolean) : []),
                ...(prevDisable && prevDisable[1] ? prevDisable[1].split(/[,\s]+/).filter(Boolean) : [])
              ]);
              if (disabledList.has(ruleId)) {
                return;
              }
              const fixEdits = [] as any[];
              if (ruleId === 'SEC008') {
                // Remove hardcoded fallback: process.env.X || 'fallback' -> process.env.X
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
              if (ruleId === 'SEC015') {
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
                type: severity === 'high' ? 'error' : 'warning',
                category: 'security',
                message,
                file,
                line: index + 1,
                range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: Math.max(1, line.length) },
                match: m[0]?.slice(0, 200),
                severity,
                ruleId,
                confidence,
                fix,
                ...(fixEdits.length ? { fixEdits } : {})
              });
            }
          });
        });

        // Project-level Next.js structure checks (emit once per project)
        if (/^(pages|app)\//.test(file)) {
          // Missing not-found/404
          if (!emittedP5_404) {
            if (hasAppDir && !hasNotFoundApp) {
              const meta = RULES.NEXT201;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, fix: meta.fix });
              emittedP5_404 = true;
            } else if (hasPagesDir && !has404Pages) {
              const meta = RULES.NEXT201;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, fix: meta.fix });
              emittedP5_404 = true;
            }
          }
          // Missing error boundary
          if (!emittedP5_error) {
            if (hasAppDir && !hasErrorApp) {
              const meta = RULES.NEXT202;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, fix: meta.fix });
              emittedP5_error = true;
            } else if (hasPagesDir && !hasErrorPages) {
              const meta = RULES.NEXT202;
              results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, fix: meta.fix });
              emittedP5_error = true;
            }
          }
          // _document for Pages Router only when code hints custom head/script usage
          if (!emittedP5_document && hasPagesDir && /from\s+['"]next\/(head|script)['"]/.test(content) && !hasDocumentPages) {
            const meta = RULES.NEXT203;
            results.push({ type: 'warning', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.5, fix: meta.fix });
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
              confidence: looksLikeSecret ? 0.9 : 0.8,
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
              fix: meta.fix,
              fixEdits
            });
          }
        });

        // Vue v-html binding (XSS risk)
        if (file.endsWith('.vue')) {
          lines.forEach((line, index) => {
            if (/v-html\s*=\s*\"|v-html\s*=\s*\'/.test(line)) {
              const meta = RULES.VUE001;
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
          });
        }

        // Next.js SSR secrets heuristic
        if (/get(ServerSideProps|StaticProps)\s*\(/.test(content) && /process\.env\./.test(content)) {
          const meta = RULES.NEXT006;
          results.push({
            type: 'error',
            category: meta.category,
            message: meta.message,
            file,
            severity: meta.severity,
            ruleId: meta.id,
            confidence: 0.6,
            fix: meta.fix
          });
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
        if (/\b(pages|app)\/api\//.test(file)) {
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
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return results;
  }
}