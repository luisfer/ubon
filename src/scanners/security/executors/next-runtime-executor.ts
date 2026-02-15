import { RULES } from '../../../rules';
import { ScanResult } from '../../../types';

interface NextRuntimeExecutorInput {
  file: string;
  content: string;
  lines: string[];
}

function rangeFor(lineNumber: number, line: string): { startLine: number; startColumn: number; endLine: number; endColumn: number } {
  return {
    startLine: lineNumber,
    startColumn: 1,
    endLine: lineNumber,
    endColumn: Math.max(1, line.length)
  };
}

export function runNextRuntimeChecks({ file, content, lines }: NextRuntimeExecutorInput): ScanResult[] {
  const results: ScanResult[] = [];
  const isApiRoute = /\b(pages|app)\/api\//.test(file);
  const isApiOrMiddleware = isApiRoute || file.includes('middleware.ts');

  // Next.js SSR secrets heuristic (legacy NEXT006)
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

  // Server -> Client secret bleed (NEXT210)
  if (/\bexport\s+async\s+function\s+get(ServerSideProps|StaticProps)\b|\bexport\s+const\s+get(ServerSideProps|StaticProps)\b/.test(content)) {
    const readsSecret = /(process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+|secret|apiKey|token)/.test(content);
    const returnsPropsWithSensitive = /return\s*\{\s*props\s*:\s*\{[\s\S]*\b(secret|token|apiKey|password|auth|key)\b/.test(content);
    if (readsSecret && returnsPropsWithSensitive) {
      const meta = RULES.NEXT210;
      results.push({
        type: 'error',
        category: meta.category,
        message: meta.message,
        file,
        severity: meta.severity,
        ruleId: meta.id,
        confidence: 0.7,
        fix: meta.fix
      });
    }
  }

  // API route basic input validation heuristic (NEXT003)
  if (isApiRoute) {
    const hasValidatorImport = /from\s+['"](zod|yup|ajv|valibot|superstruct|class-validator)['"]/.test(content) || /import\s+\{?\s*(z|yup|Ajv|object|safeParse)/.test(content);
    const usesRequestParams = lines.some((line) => /(req|request)\.(body|query|params)/.test(line));
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

  // Next.js specific checks
  if (isApiOrMiddleware) {
    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      if (/res\.json\s*\(\s*\{[^}]*\b(token|jwt|accessToken|authToken)\s*:/.test(line)) {
        const meta = RULES.NEXT007;
        results.push({
          type: 'error',
          category: meta.category,
          message: meta.message,
          file,
          line: lineNumber,
          range: rangeFor(lineNumber, line),
          severity: meta.severity,
          ruleId: meta.id,
          confidence: 0.9,
          fix: meta.fix
        });
      }

      if (/res\.redirect\s*\(\s*(req\.query\.|req\.body\.|req\.params\.)/.test(line)) {
        const meta = RULES.NEXT009;
        results.push({
          type: 'error',
          category: meta.category,
          message: meta.message,
          file,
          line: lineNumber,
          range: rangeFor(lineNumber, line),
          severity: meta.severity,
          ruleId: meta.id,
          confidence: 0.8,
          fix: meta.fix
        });
      }

      if (/Access-Control-Allow-Origin.*\*/.test(line) || /cors\s*\(\s*\{\s*origin:\s*['"`]\*['"`]/.test(line)) {
        const meta = RULES.NEXT010;
        results.push({
          type: 'warning',
          category: meta.category,
          message: meta.message,
          file,
          line: lineNumber,
          range: rangeFor(lineNumber, line),
          severity: meta.severity,
          ruleId: meta.id,
          confidence: 0.7,
          fix: meta.fix
        });
      }

    });

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

  const isClientExposedFile =
    file.includes('components/') ||
    (file.includes('pages/') && !file.includes('/api/')) ||
    (file.includes('app/') && !file.includes('/api/'));
  if (isClientExposedFile) {
    lines.forEach((line, index) => {
      if (/process\.env\.(?!NEXT_PUBLIC_)\w+/.test(line)) {
        const lineNumber = index + 1;
        const meta = RULES.NEXT011;
        results.push({
          type: 'error',
          category: meta.category,
          message: meta.message,
          file,
          line: lineNumber,
          range: rangeFor(lineNumber, line),
          severity: meta.severity,
          ruleId: meta.id,
          confidence: 0.8,
          fix: meta.fix
        });
      }
    });
  }

  // API route structure + auth checks
  if (isApiRoute) {
    const isPagesAPI = /\bpages\/api\//.test(file);
    const isAppRoute = /\bapp\/api\//.test(file);
    if (isPagesAPI) {
      const mentionsReqMethodCheck = /req\.method/.test(content) && /(GET|POST|PUT|DELETE|PATCH)/.test(content);
      if (!mentionsReqMethodCheck) {
        const meta = RULES.NEXT209;
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
    if (isAppRoute) {
      const hasMethodExports = /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/.test(content);
      if (!hasMethodExports) {
        const meta = RULES.NEXT209;
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
    const returnsSensitive = /res\.(json|send)\(\s*\{[^}]*\b(user|email|token|secret|apiKey)\b/.test(content);
    const hasAuthSignals = /(getServerSession|next-auth|Authorization|getToken|cookies\(|jwt)/.test(content);
    if (returnsSensitive && !hasAuthSignals) {
      const meta = RULES.NEXT205;
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

  // Client navigation to external URL
  if (/useRouter\(\)/.test(content) || /from\s+['"]next\/navigation['"]/.test(content)) {
    lines.forEach((line, index) => {
      if (/router\.push\(\s*['"][a-z]+:\/\//i.test(line)) {
        const lineNumber = index + 1;
        const meta = RULES.NEXT208;
        results.push({
          type: 'warning',
          category: meta.category,
          message: meta.message,
          file,
          line: lineNumber,
          range: rangeFor(lineNumber, line),
          severity: meta.severity,
          ruleId: meta.id,
          confidence: 0.7,
          fix: meta.fix
        });
      }
    });
  }

  return results;
}
