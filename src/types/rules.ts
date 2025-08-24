export type RuleSeverity = 'high' | 'medium' | 'low';
export type RuleCategory = 'security' | 'accessibility' | 'links' | 'performance' | 'seo';

export interface RuleMeta {
  id: string;
  category: RuleCategory;
  severity: RuleSeverity;
  message: string;
  fix?: string;
  helpUri?: string;
  impact?: string; // "why it matters" explanation
}

// Central registry of rules used across scanners.
export const RULES: Record<string, RuleMeta> = {
  // Accessibility
  A11Y001: { id: 'A11Y001', category: 'accessibility', severity: 'medium', message: 'Image without alt attribute', fix: 'Add descriptive alt attribute to images', helpUri: 'https://webaim.org/techniques/alttext/', impact: 'Screen readers cannot describe images to visually impaired users' },
  A11Y002: { id: 'A11Y002', category: 'accessibility', severity: 'medium', message: 'Input without label or aria-label', fix: 'Add proper labeling to form inputs', helpUri: 'https://web.dev/labels-and-text-alternatives/', impact: 'Users with disabilities cannot understand what the input field is for' },
  A11Y003: { id: 'A11Y003', category: 'accessibility', severity: 'high', message: 'Empty button without aria-label', fix: 'Add descriptive text or aria-label to buttons', helpUri: 'https://dequeuniversity.com/rules/axe/4.7/button-name', impact: 'Screen readers cannot announce button purpose, blocking critical actions' },
  A11Y004: { id: 'A11Y004', category: 'accessibility', severity: 'medium', message: 'Div with onClick (not keyboard accessible)', fix: 'Use button element or add keyboard event handlers', helpUri: 'https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Roles/button_role', impact: 'Keyboard-only users cannot activate this interactive element' },
  A11Y005: { id: 'A11Y005', category: 'accessibility', severity: 'low', message: 'Link without href attribute', fix: 'Add href attribute or use button element', helpUri: 'https://dequeuniversity.com/rules/axe/4.7/link-name' },
  A11Y006: { id: 'A11Y006', category: 'accessibility', severity: 'low', message: 'Image missing width/height attributes', fix: 'Specify width and height to avoid layout shifts', helpUri: 'https://web.dev/optimize-cls/' },
  A11Y007: { id: 'A11Y007', category: 'accessibility', severity: 'low', message: 'next/image used without width and height', fix: 'Provide width and height props to <Image>', helpUri: 'https://nextjs.org/docs/pages/api-reference/components/image' },

  // Security (JS/TS)
  SEC001: { id: 'SEC001', category: 'security', severity: 'high', message: 'Potential API key or secret token exposed', fix: 'Move sensitive keys to environment variables', impact: 'Exposed credentials can be stolen from source code and used to access your services', helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html' },
  SEC002: { id: 'SEC002', category: 'security', severity: 'medium', message: 'Supabase URL hardcoded (should use env var)', fix: 'Use NEXT_PUBLIC_SUPABASE_URL environment variable', impact: 'Hardcoded URLs make it difficult to manage different environments securely' },
  SEC003: { id: 'SEC003', category: 'security', severity: 'high', message: 'Supabase anon key hardcoded (JWT token pattern)', fix: 'Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable', impact: 'Exposed database keys allow unauthorized access to your Supabase instance' },
  SEC004: { id: 'SEC004', category: 'security', severity: 'medium', message: 'Supabase URL hardcoded in variable', fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_URL', impact: 'Hardcoded configuration prevents secure environment management' },
  SEC005: { id: 'SEC005', category: 'security', severity: 'high', message: 'Supabase key hardcoded in variable', fix: 'Use process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY', impact: 'Database credentials in code can be extracted and misused' },
  SEC006: { id: 'SEC006', category: 'security', severity: 'high', message: 'Hardcoded password detected', fix: 'Use environment variables for passwords', impact: 'Passwords in source code can be stolen by anyone with access to the codebase' },
  SEC007: { id: 'SEC007', category: 'security', severity: 'high', message: 'Database URL hardcoded', fix: 'Use environment variable for database connection', impact: 'Database credentials allow complete access to your data if compromised' },
  SEC008: { id: 'SEC008', category: 'security', severity: 'medium', message: 'Environment variable with hardcoded fallback', fix: 'Remove hardcoded fallback values', impact: 'Fallbacks can leak sensitive defaults and bypass environment-based security' },
  SEC009: { id: 'SEC009', category: 'security', severity: 'high', message: 'AWS Access Key ID exposed', fix: 'Move AWS credentials to environment variables', impact: 'AWS credentials can be used to access and bill your cloud resources' },
  SEC010: { id: 'SEC010', category: 'security', severity: 'high', message: 'Google OAuth token exposed', fix: 'Use secure token storage', impact: 'OAuth tokens can be used to impersonate users and access their Google data' },
  SEC011: { id: 'SEC011', category: 'security', severity: 'high', message: 'GitHub token exposed', fix: 'Use environment variables for GitHub tokens', impact: 'GitHub tokens allow access to repositories and can be used for supply chain attacks' },
  SEC012: { id: 'SEC012', category: 'security', severity: 'high', message: 'Stripe live secret key exposed', fix: 'Move Stripe live keys to secure environment', impact: 'Live Stripe keys can be used to process payments and access customer data' },
  SEC013: { id: 'SEC013', category: 'security', severity: 'medium', message: 'Stripe live publishable key exposed', fix: 'Use environment variable for Stripe keys', impact: 'Exposed payment keys can be used to initiate unauthorized transactions' },
  SEC014: { id: 'SEC014', category: 'security', severity: 'high', message: 'OpenAI API key exposed', fix: 'Use OPENAI_API_KEY environment variable', impact: 'OpenAI keys can be stolen and used to run up charges on your account', helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html' },
  SEC015: { id: 'SEC015', category: 'security', severity: 'low', message: 'Console statement found (may leak sensitive info)', fix: 'Remove console statements before production', impact: 'Console logs can expose sensitive data in browser developer tools' },
  SEC016: { id: 'SEC016', category: 'security', severity: 'high', message: 'Use of eval() detected (security risk)', fix: 'Replace eval() with safer alternatives', impact: 'eval() can execute malicious code and is a common vector for code injection attacks', helpUri: 'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/eval' },
  SEC017: { id: 'SEC017', category: 'security', severity: 'medium', message: 'dangerouslySetInnerHTML usage (XSS risk)', fix: 'Sanitize HTML content or use safer alternatives', impact: 'Unsanitized HTML can inject malicious scripts that steal user data', helpUri: 'https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html' },
  SEC018: { id: 'SEC018', category: 'security', severity: 'high', message: 'High-entropy string literal (possible secret)', fix: 'Move secrets to environment variables; rotate credentials', impact: 'High-entropy strings often contain API keys or tokens that can be misused', helpUri: 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures' },
  SEC019: { id: 'SEC019', category: 'security', severity: 'high', message: 'React component injection via createElement', fix: 'Disallow dynamic element types from untrusted input', impact: 'Component injection can lead to XSS attacks and arbitrary code execution' },
  LOG001: { id: 'LOG001', category: 'security', severity: 'medium', message: 'Potential secret logged to console/logger', fix: 'Avoid logging secrets; redact values before logging', impact: 'Secrets in logs can be exposed through log aggregation systems or error tracking', helpUri: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html' },
  OSV001: { id: 'OSV001', category: 'security', severity: 'high', message: 'Vulnerable dependency detected', fix: 'Upgrade to a patched version' },

  // Networking (JS)
  JSNET001: { id: 'JSNET001', category: 'security', severity: 'medium', message: 'HTTP request without timeout/retry policy', fix: 'Add timeout/backoff to axios/fetch calls', helpUri: 'https://developer.mozilla.org/docs/Web/API/AbortController' },

  // Cookies / headers
  COOKIE001: { id: 'COOKIE001', category: 'security', severity: 'medium', message: 'Set-Cookie missing HttpOnly/Secure/SameSite', fix: 'Add HttpOnly; Secure; SameSite=Lax (or Strict) to cookies', impact: 'Insecure cookies can be stolen via XSS attacks or intercepted over insecure connections', helpUri: 'https://owasp.org/www-community/controls/SecureCookieAttributes' },
  COOKIE002: { id: 'COOKIE002', category: 'security', severity: 'high', message: 'JWT token exposed in client-side cookie without security flags', fix: 'Add HttpOnly and Secure flags to JWT cookies', impact: 'JWT tokens in insecure cookies can be stolen and used to impersonate users', helpUri: 'https://owasp.org/www-community/controls/SecureCookieAttributes' },
  COOKIE003: { id: 'COOKIE003', category: 'security', severity: 'high', message: 'Sensitive data returned in JSON response (potential token leak)', fix: 'Avoid returning tokens/secrets in API responses; use secure cookies instead', impact: 'Tokens in JSON responses are visible to client-side JavaScript and can be stolen' },
  COOKIE004: { id: 'COOKIE004', category: 'security', severity: 'medium', message: 'Cookie used without domain/path restrictions', fix: 'Set appropriate domain and path attributes for cookies', impact: 'Overly broad cookie scope can lead to unintended exposure to subdomains' },

  // Env
  ENV001: { id: 'ENV001', category: 'security', severity: 'high', message: '.env file may not be in .gitignore', fix: 'Add .env files to .gitignore to prevent accidental commits' },
  ENV002: { id: 'ENV002', category: 'security', severity: 'high', message: 'Potential API key in .env file', fix: 'Ensure this .env file is in .gitignore and not committed' },
  ENV004: { id: 'ENV004', category: 'security', severity: 'high', message: 'Secret value in .env file', fix: 'Verify .env is in .gitignore and use .env.example for documentation' },
  ENV005: { id: 'ENV005', category: 'security', severity: 'medium', message: 'Supabase credentials in .env', fix: 'Ensure this .env file is not committed to version control' },
  ENV006: { id: 'ENV006', category: 'security', severity: 'low', message: 'Missing .env.example file for documentation', fix: 'Create .env.example with placeholder values for team setup' },

  // Links
  LINK001: { id: 'LINK001', category: 'links', severity: 'low', message: 'Link checking requires puppeteer installation', fix: 'Install with: npm install puppeteer' },
  LINK002: { id: 'LINK002', category: 'links', severity: 'medium', message: 'External link unreachable or 4xx/5xx', fix: 'Update URL or ensure target is reachable' },
  LINK003: { id: 'LINK003', category: 'links', severity: 'medium', message: 'Internal link or resource broken', fix: 'Fix route or asset; check server logs' },
  NEXT001: { id: 'NEXT001', category: 'links', severity: 'low', message: 'next/link used without anchor or child text (legacyBehavior)', fix: 'Wrap link content with <a> or set proper child' },
  NEXT002: { id: 'NEXT002', category: 'links', severity: 'medium', message: 'In-page <a> used for client navigation; prefer next/link', fix: 'Use <Link href="..."><a>…</a></Link> or modern API' },
  NEXT003: { id: 'NEXT003', category: 'security', severity: 'medium', message: 'Next.js API route uses request params without validation', fix: 'Validate input with zod/yup/ajv before usage' },
  NEXT004: { id: 'NEXT004', category: 'security', severity: 'high', message: 'Dynamic import with user-controlled path', fix: 'Avoid dynamic import sources from untrusted input' },
  NEXT005: { id: 'NEXT005', category: 'accessibility', severity: 'low', message: 'External <img> used in Next.js app (consider next/image)', fix: 'Use next/image for external sources with proper config' },
  NEXT006: { id: 'NEXT006', category: 'security', severity: 'high', message: 'Sensitive data exposed via getStaticProps/getServerSideProps', fix: 'Do not include secrets/env in returned props' },

  // Python
  PYSEC001: { id: 'PYSEC001', category: 'security', severity: 'high', message: 'Potential API key exposed', fix: 'Move secrets to environment variables' },
  PYSEC002: { id: 'PYSEC002', category: 'security', severity: 'high', message: 'Use of exec() detected', fix: 'Avoid exec(); use safer alternatives' },
  PYSEC003: { id: 'PYSEC003', category: 'security', severity: 'high', message: 'Use of eval() detected', fix: 'Avoid eval(); use safer alternatives' },
  PYSEC004: { id: 'PYSEC004', category: 'security', severity: 'high', message: 'subprocess with shell=True', fix: 'Avoid shell=True; pass args as list' },
  PYSEC005: { id: 'PYSEC005', category: 'security', severity: 'medium', message: 'yaml.load() unsafe without Loader', fix: 'Use yaml.safe_load()' },
  PYSEC006: { id: 'PYSEC006', category: 'security', severity: 'medium', message: 'Insecure pickle usage', fix: 'Avoid pickle with untrusted data' },
  PYSEC007: { id: 'PYSEC007', category: 'security', severity: 'medium', message: 'TLS verification disabled', fix: 'Remove verify=False' },
  PYSEC009: { id: 'PYSEC009', category: 'security', severity: 'medium', message: 'DEBUG=True in settings', fix: 'Disable DEBUG in production' },
  PYSEC010: { id: 'PYSEC010', category: 'security', severity: 'low', message: 'ALLOWED_HOSTS includes *', fix: 'Restrict ALLOWED_HOSTS' },
  PYNET001: { id: 'PYNET001', category: 'security', severity: 'medium', message: 'requests call without timeout', fix: 'Add timeout= to requests.* calls' }
  ,
  // Docker / CI
  DOCKER001: { id: 'DOCKER001', category: 'security', severity: 'medium', message: 'Dockerfile runs as root (USER root or no USER)', fix: 'Add a non-root USER' },
  DOCKER002: { id: 'DOCKER002', category: 'security', severity: 'high', message: 'Secrets defined via ENV in Dockerfile', fix: 'Avoid embedding secrets in Docker images' },
  DOCKER003: { id: 'DOCKER003', category: 'security', severity: 'low', message: 'Docker base image uses :latest tag', fix: 'Pin to a specific version tag' },
  DOCKER004: { id: 'DOCKER004', category: 'security', severity: 'low', message: 'apt-get install without cleaning apt cache', fix: 'Run rm -rf /var/lib/apt/lists/* after apt-get' },
  // Env drift
  ENV007: { id: 'ENV007', category: 'security', severity: 'low', message: 'Environment variable drift between .env and .env.example', fix: 'Align keys in .env and .env.example' },
  // Vue
  VUE001: { id: 'VUE001', category: 'security', severity: 'high', message: 'v-html binding (XSS risk)', fix: 'Avoid v-html or sanitize input before binding' },
  // CI
  GHA001: { id: 'GHA001', category: 'security', severity: 'high', message: 'Secrets may be echoed in GitHub Actions workflow', fix: 'Do not print secrets to logs; remove echo/printf of secrets' },
  
  // Next.js JWT/Cookie security rules  
  NEXT007: { id: 'NEXT007', category: 'security', severity: 'high', message: 'JWT token exposed in Next.js API response', fix: 'Use httpOnly cookies instead of returning tokens in JSON', impact: 'JWT tokens in API responses can be stolen via XSS and used for session hijacking' },
  NEXT008: { id: 'NEXT008', category: 'security', severity: 'medium', message: 'Missing security headers in Next.js API route', fix: 'Add security headers like X-Content-Type-Options, X-Frame-Options', impact: 'Missing security headers expose the application to various client-side attacks' },
  NEXT009: { id: 'NEXT009', category: 'security', severity: 'high', message: 'Unsafe redirect in Next.js API route', fix: 'Validate redirect URLs against allowlist', impact: 'Open redirects can be used for phishing attacks and credential theft', helpUri: 'https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet' },
  NEXT010: { id: 'NEXT010', category: 'security', severity: 'medium', message: 'CORS configuration too permissive', fix: 'Restrict CORS to specific origins instead of using wildcard', impact: 'Overly permissive CORS allows malicious sites to make requests on behalf of users', helpUri: 'https://developer.mozilla.org/docs/Web/HTTP/CORS' },
  NEXT011: { id: 'NEXT011', category: 'security', severity: 'high', message: 'Environment variable leaked in client-side code', fix: 'Use NEXT_PUBLIC_ prefix only for truly public variables', impact: 'Server-side environment variables exposed to client reveal sensitive configuration', helpUri: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser' }
};


