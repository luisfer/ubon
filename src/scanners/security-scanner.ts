import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions } from '../types';
import { RULES, getRule } from '../rules';
import { ResultCache } from '../utils/result-cache';
import { runNetworkAndCookieChecks } from './security/executors/network-cookie-executor';
import { runSecretSignalChecks } from './security/executors/secret-signal-executor';
import { runNextStructureChecks, NextStructureState } from './security/executors/next-structure-executor';

export class SecurityScanner implements Scanner {
  name = 'Security Scanner';

  // Rule IDs that have been migrated to modular rules with patterns
  private readonly modularRuleIds = [
    'SEC001', 'SEC002', 'SEC003', 'SEC004', 'SEC005', 'SEC006', 'SEC007',
    'SEC008', 'SEC009', 'SEC010', 'SEC011', 'SEC012', 'SEC013', 'SEC014',
    'SEC015', 'SEC016', 'SEC017'
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
    'COOKIE001': 'Cookie missing security attributes (HttpOnly, Secure, SameSite)'
  };

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const ignorePatterns = ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**', 'coverage/**', '.git/**', '.tmp*/**', 'tmp/**'];
    if (!options.detailed) {
      ignorePatterns.push('**/__tests__/**', '**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}');
    }

    const files = await glob('**/*.{js,jsx,ts,tsx,vue,env}', {
      cwd: options.directory,
      ignore: ignorePatterns
    });
    const signature = `sec:2:profile:${options.profile || 'auto'}`;
    const resultCache = options.noResultCache ? null : new ResultCache(options.directory, signature);
    let processed = 0;

    // Load modular rules
    const modularRules = this.modularRuleIds.map(id => getRule(id)).filter(Boolean);

    const nextStructureState: NextStructureState = {
      hasAppDir: files.some((f) => /^app\//.test(f)),
      hasPagesDir: files.some((f) => /^pages\//.test(f)),
      hasNotFoundApp: files.some((f) => /^app\/not-found\.(js|jsx|ts|tsx)$/.test(f)),
      has404Pages: files.some((f) => /^pages\/404\.(js|jsx|ts|tsx)$/.test(f)),
      hasErrorApp: files.some((f) => /^app\/error\.(js|jsx|ts|tsx)$/.test(f)),
      hasErrorPages: files.some((f) => /^pages\/_error\.(js|jsx|ts|tsx)$/.test(f)),
      hasDocumentPages: files.some((f) => /^pages\/_document\.(js|jsx|ts|tsx)$/.test(f)),
      emittedMissing404: false,
      emittedMissingErrorBoundary: false,
      emittedMissingDocument: false
    };

    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
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
                  const matchedText = m[0] || '';
                  const isSecretRule = ['SEC001', 'SEC003', 'SEC009', 'SEC011', 'SEC014'].includes(pattern.ruleId);
                  const looksLikeRegexSource = /[\[\]\{\}\\]/.test(matchedText) && /\/.+\/[gimsuy]*/.test(line);
                  if (isSecretRule && looksLikeRegexSource) {
                    return;
                  }

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
                    match: matchedText.slice(0, 200),
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

        results.push(...runNextStructureChecks({
          file,
          content,
          state: nextStructureState,
          confidenceReasons: this.confidenceReasons
        }));

        results.push(...runNetworkAndCookieChecks({ file, lines }));

        results.push(...runSecretSignalChecks({ file, lines }));

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

        // Next.js SSR secrets heuristic (legacy NEXT006)
        if (/get(ServerSideProps|StaticProps)\s*\(/.test(content) && /process\.env\./.test(content)) {
          const meta = RULES.NEXT006;
          results.push({ type: 'error', category: meta.category, message: meta.message, file, severity: meta.severity, ruleId: meta.id, confidence: 0.6, fix: meta.fix });
        }

        // Experimental P5: Server -> Client secret bleed (NEXT210)
        if (/\bexport\s+async\s+function\s+get(ServerSideProps|StaticProps)\b|\bexport\s+const\s+get(ServerSideProps|StaticProps)\b/.test(content)) {
          const readsSecret = /(process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+|secret|apiKey|token)/.test(content);
          const returnsPropsWithSensitive = /return\s*\{\s*props\s*:\s*\{[\s\S]*\b(secret|token|apiKey|password|auth|key)\b/.test(content);
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
