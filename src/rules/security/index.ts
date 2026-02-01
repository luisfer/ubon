import { Rule, RuleMeta } from '../types';

// Import modular rule files with patterns
import SEC001 from './SEC001';
import SEC002 from './SEC002';
import SEC003 from './SEC003';
import SEC004 from './SEC004';
import SEC005 from './SEC005';
import SEC006 from './SEC006';
import SEC007 from './SEC007';
import SEC008 from './SEC008';
import SEC009 from './SEC009';
import SEC010 from './SEC010';
import SEC011 from './SEC011';
import SEC012 from './SEC012';
import SEC013 from './SEC013';
import SEC014 from './SEC014';
import SEC015 from './SEC015';
import SEC016 from './SEC016';
import SEC017 from './SEC017';

const makeRule = (meta: RuleMeta, fileTypes?: string[]): Rule => ({
  meta,
  impl: {
    fileTypes: fileTypes || ['js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'rb', 'html', 'env', 'md', 'mdx', 'yml', 'yaml', 'json', 'dockerfile']
  }
});

export const securityRules: Record<string, Rule> = {
  // Core secrets/security - modular rules with patterns
  SEC001,
  SEC002,
  SEC003,
  SEC004,
  SEC005,
  SEC006,
  SEC007,
  SEC008,
  SEC009,
  SEC010,
  SEC011,
  SEC012,
  SEC013,
  SEC014,
  SEC015,
  SEC016,
  SEC017,

  // Additional security rules (metadata only, detection in scanners)
  SEC018: makeRule({ id: 'SEC018', category: 'security', severity: 'high', message: 'High-entropy string literal (possible secret)', fix: 'Move secrets to environment variables; rotate credentials', impact: 'High-entropy strings often contain API keys or tokens that can be misused', helpUri: 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures' }),
  SEC019: makeRule({ id: 'SEC019', category: 'security', severity: 'high', message: 'React component injection via createElement', fix: 'Disallow dynamic element types from untrusted input', impact: 'Component injection can lead to XSS attacks and arbitrary code execution' }),
  LOG001: makeRule({ id: 'LOG001', category: 'security', severity: 'medium', message: 'Potential secret logged to console/logger', fix: 'Avoid logging secrets; redact values before logging', impact: 'Secrets in logs can be exposed through log aggregation systems or error tracking', helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html' }),
  OSV001: makeRule({ id: 'OSV001', category: 'security', severity: 'high', message: 'Vulnerable dependency detected', fix: 'Upgrade to a patched version' }, ['json', 'txt', 'lock']),

  // Networking (JS)
  JSNET001: makeRule({ id: 'JSNET001', category: 'security', severity: 'medium', message: 'HTTP request without timeout/retry policy', fix: 'Add timeout/backoff to axios/fetch calls', helpUri: 'https://developer.mozilla.org/docs/Web/API/AbortController' }),

  // Cookies / headers
  COOKIE001: makeRule({ id: 'COOKIE001', category: 'security', severity: 'medium', message: 'Set-Cookie missing HttpOnly/Secure/SameSite', fix: 'Add HttpOnly; Secure; SameSite=Lax (or Strict) to cookies', impact: 'Insecure cookies can be stolen via XSS attacks or intercepted over insecure connections', helpUri: 'https://owasp.org/www-community/controls/SecureCookieAttributes' }),
  COOKIE002: makeRule({ id: 'COOKIE002', category: 'security', severity: 'high', message: 'JWT token exposed in client-side cookie without security flags', fix: 'Add HttpOnly and Secure flags to JWT cookies', impact: 'JWT tokens in insecure cookies can be stolen and used to impersonate users', helpUri: 'https://owasp.org/www-community/controls/SecureCookieAttributes' }),
  COOKIE003: makeRule({ id: 'COOKIE003', category: 'security', severity: 'high', message: 'Sensitive data returned in JSON response (potential token leak)', fix: 'Avoid returning tokens/secrets in API responses; use secure cookies instead', impact: 'Tokens in JSON responses are visible to client-side JavaScript and can be stolen' }),
  COOKIE004: makeRule({ id: 'COOKIE004', category: 'security', severity: 'medium', message: 'Cookie used without domain/path restrictions', fix: 'Set appropriate domain and path attributes for cookies', impact: 'Overly broad cookie scope can lead to unintended exposure to subdomains' }),

  // Env
  ENV001: makeRule({ id: 'ENV001', category: 'security', severity: 'high', message: '.env file may not be in .gitignore', fix: 'Add .env files to .gitignore to prevent accidental commits' }, ['env', 'gitignore']),
  ENV002: makeRule({ id: 'ENV002', category: 'security', severity: 'high', message: 'Potential API key in .env file', fix: 'Ensure this .env file is in .gitignore and not committed' }, ['env']),
  ENV004: makeRule({ id: 'ENV004', category: 'security', severity: 'high', message: 'Secret value in .env file', fix: 'Verify .env is in .gitignore and use .env.example for documentation' }, ['env']),
  ENV005: makeRule({ id: 'ENV005', category: 'security', severity: 'medium', message: 'Supabase credentials in .env', fix: 'Ensure this .env file is not committed to version control' }, ['env']),
  ENV006: makeRule({ id: 'ENV006', category: 'security', severity: 'low', message: 'Missing .env.example file for documentation', fix: 'Create .env.example with placeholder values for team setup' }, ['env']),
  ENV007: makeRule({ id: 'ENV007', category: 'security', severity: 'low', message: 'Environment variable drift between .env and .env.example', fix: 'Align keys in .env and .env.example' }, ['env']),

  // Python
  PYSEC001: makeRule({ id: 'PYSEC001', category: 'security', severity: 'high', message: 'Potential API key exposed', fix: 'Move secrets to environment variables' }, ['py']),
  PYSEC002: makeRule({ id: 'PYSEC002', category: 'security', severity: 'high', message: 'Use of exec() detected', fix: 'Avoid exec(); use safer alternatives' }, ['py']),
  PYSEC003: makeRule({ id: 'PYSEC003', category: 'security', severity: 'high', message: 'Use of eval() detected', fix: 'Avoid eval(); use safer alternatives' }, ['py']),
  PYSEC004: makeRule({ id: 'PYSEC004', category: 'security', severity: 'high', message: 'subprocess with shell=True', fix: 'Avoid shell=True; pass args as list' }, ['py']),
  PYSEC005: makeRule({ id: 'PYSEC005', category: 'security', severity: 'medium', message: 'yaml.load() unsafe without Loader', fix: 'Use yaml.safe_load()' }, ['py']),
  PYSEC006: makeRule({ id: 'PYSEC006', category: 'security', severity: 'medium', message: 'Insecure pickle usage', fix: 'Avoid pickle with untrusted data' }, ['py']),
  PYSEC007: makeRule({ id: 'PYSEC007', category: 'security', severity: 'medium', message: 'TLS verification disabled', fix: 'Remove verify=False' }, ['py']),
  PYSEC009: makeRule({ id: 'PYSEC009', category: 'security', severity: 'medium', message: 'DEBUG=True in settings', fix: 'Disable DEBUG in production' }, ['py']),
  PYSEC010: makeRule({ id: 'PYSEC010', category: 'security', severity: 'low', message: 'ALLOWED_HOSTS includes *', fix: 'Restrict ALLOWED_HOSTS' }, ['py']),
  PYNET001: makeRule({ id: 'PYNET001', category: 'security', severity: 'medium', message: 'requests call without timeout', fix: 'Add timeout= to requests.* calls' }, ['py']),

  // Docker / CI
  DOCKER001: makeRule({ id: 'DOCKER001', category: 'security', severity: 'medium', message: 'Dockerfile runs as root (USER root or no USER)', fix: 'Add a non-root USER' }, ['dockerfile']),
  DOCKER002: makeRule({ id: 'DOCKER002', category: 'security', severity: 'high', message: 'Secrets defined via ENV in Dockerfile', fix: 'Avoid embedding secrets in Docker images' }, ['dockerfile']),
  DOCKER003: makeRule({ id: 'DOCKER003', category: 'security', severity: 'low', message: 'Docker base image uses :latest tag', fix: 'Pin to a specific version tag' }, ['dockerfile']),
  DOCKER004: makeRule({ id: 'DOCKER004', category: 'security', severity: 'low', message: 'apt-get install without cleaning apt cache', fix: 'Run rm -rf /var/lib/apt/lists/* after apt-get' }, ['dockerfile']),

  // Vue & CI
  VUE001: makeRule({ id: 'VUE001', category: 'security', severity: 'high', message: 'v-html binding (XSS risk)', fix: 'Avoid v-html or sanitize input before binding' }, ['vue']),
  GHA001: makeRule({ id: 'GHA001', category: 'security', severity: 'high', message: 'Secrets may be echoed in GitHub Actions workflow', fix: 'Do not print secrets to logs; remove echo/printf of secrets' }, ['yml', 'yaml']),

  // Next.js security
  NEXT003: makeRule({ id: 'NEXT003', category: 'security', severity: 'medium', message: 'Next.js API route uses request params without validation', fix: 'Validate input with zod/yup/ajv before usage' }),
  NEXT004: makeRule({ id: 'NEXT004', category: 'security', severity: 'high', message: 'Dynamic import with user-controlled path', fix: 'Avoid dynamic import sources from untrusted input' }),
  NEXT006: makeRule({ id: 'NEXT006', category: 'security', severity: 'high', message: 'Sensitive data exposed via getStaticProps/getServerSideProps', fix: 'Do not include secrets/env in returned props' }),
  NEXT007: makeRule({ id: 'NEXT007', category: 'security', severity: 'high', message: 'JWT token exposed in Next.js API response', fix: 'Use httpOnly cookies instead of returning tokens in JSON', impact: 'JWT tokens in API responses can be stolen via XSS and used for session hijacking' }),
  NEXT008: makeRule({ id: 'NEXT008', category: 'security', severity: 'medium', message: 'Missing security headers in Next.js API route', fix: 'Add security headers like X-Content-Type-Options, X-Frame-Options', impact: 'Missing security headers expose the application to various client-side attacks' }),
  NEXT009: makeRule({ id: 'NEXT009', category: 'security', severity: 'high', message: 'Unsafe redirect in Next.js API route', fix: 'Validate redirect URLs against allowlist', impact: 'Open redirects can be used for phishing attacks and credential theft', helpUri: 'https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet' }),
  NEXT010: makeRule({ id: 'NEXT010', category: 'security', severity: 'medium', message: 'CORS configuration too permissive', fix: 'Restrict CORS to specific origins instead of using wildcard', impact: 'Overly permissive CORS allows malicious sites to make requests on behalf of users', helpUri: 'https://developer.mozilla.org/docs/Web/HTTP/CORS' }),
  NEXT011: makeRule({ id: 'NEXT011', category: 'security', severity: 'high', message: 'Environment variable leaked in client-side code', fix: 'Use NEXT_PUBLIC_ prefix only for truly public variables', impact: 'Server-side environment variables exposed to client reveal sensitive configuration', helpUri: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser' }),
  NEXT201: makeRule({ id: 'NEXT201', category: 'security', severity: 'low', message: 'Missing 404/not-found page', fix: 'Add app/not-found.tsx or pages/404.tsx' }),
  NEXT202: makeRule({ id: 'NEXT202', category: 'security', severity: 'low', message: 'Missing error boundary page', fix: 'Add app/error.tsx or pages/_error.tsx' }),
  NEXT203: makeRule({ id: 'NEXT203', category: 'security', severity: 'low', message: 'Missing _document.tsx when customizing head/scripts', fix: 'Add pages/_document.tsx for custom document structure' }),
  NEXT205: makeRule({ id: 'NEXT205', category: 'security', severity: 'medium', message: 'API route may be accessible without authentication', fix: 'Require auth (NextAuth getServerSession/JWT/cookie checks) for sensitive endpoints', helpUri: 'https://next-auth.js.org/configuration/nextjs#api-routes', impact: 'Unauthenticated access to sensitive APIs can leak data or allow abuse' }),
  NEXT208: makeRule({ id: 'NEXT208', category: 'security', severity: 'medium', message: 'router.push() to external URL', fix: 'Validate and restrict redirect targets to an allowlist or same-origin', helpUri: 'https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet', impact: 'Open redirects facilitate phishing and credential theft' }),
  NEXT209: makeRule({ id: 'NEXT209', category: 'security', severity: 'medium', message: 'API route missing HTTP method validation', fix: 'Validate req.method in Pages API or export method handlers (GET/POST/...) in App Router', helpUri: 'https://nextjs.org/docs/app/building-your-application/routing/route-handlers', impact: 'Accepting unintended methods broadens attack surface and leads to undefined behavior' }),
  NEXT210: makeRule({ id: 'NEXT210', category: 'security', severity: 'high', message: 'Server secret serialized to client props (leak risk)', fix: 'Do not pass secrets in getServerSideProps/getStaticProps props; keep server-only or use secure cookies', helpUri: 'https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props#caveats', impact: 'Secrets sent via props are exposed to the browser and can be exfiltrated' })
};
