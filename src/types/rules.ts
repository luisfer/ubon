// Legacy rule registry. Prefer `src/rules/*` (modular registry) for new rules.
// Categories/severities are re-exported from the canonical source of truth so
// adding a new category requires updating exactly one file.
export type { RuleSeverity, RuleCategory, RuleMeta } from '../rules/types';
import type { RuleMeta } from '../rules/types';

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
  SEC020: { id: 'SEC020', category: 'security', severity: 'high', message: 'SQL sink called with string interpolation or concatenation (SQL injection)', fix: 'Use parameterised queries or the ORM query builder instead of interpolating values into SQL strings.', impact: 'String interpolation in SQL is the textbook injection vector — attackers can read, modify, or drop the database.', helpUri: 'https://owasp.org/Top10/A03_2021-Injection' },
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

  // Docker / CI
  DOCKER001: { id: 'DOCKER001', category: 'security', severity: 'medium', message: 'Dockerfile runs as root (USER root or no USER)', fix: 'Add a non-root USER' },
  DOCKER002: { id: 'DOCKER002', category: 'security', severity: 'high', message: 'Secrets defined via ENV in Dockerfile', fix: 'Avoid embedding secrets in Docker images' },
  DOCKER003: { id: 'DOCKER003', category: 'security', severity: 'low', message: 'Docker base image uses :latest tag', fix: 'Pin to a specific version tag' },
  DOCKER004: { id: 'DOCKER004', category: 'security', severity: 'low', message: 'apt-get install without cleaning apt cache', fix: 'Run rm -rf /var/lib/apt/lists/* after apt-get' },
  // Env drift
  ENV007: { id: 'ENV007', category: 'security', severity: 'low', message: 'Environment variable drift between .env and .env.example', fix: 'Align keys in .env and .env.example' },
  ENV008: { id: 'ENV008', category: 'security', severity: 'high', message: 'Client-exposed env var carries a database/service connection URL (leaks to browser bundle)', fix: 'Rename without the NEXT_PUBLIC_/VITE_/PUBLIC_/EXPO_PUBLIC_ prefix so the value stays server-only; rotate the credential if it has already shipped', impact: 'Any NEXT_PUBLIC_/VITE_/PUBLIC_ env value is inlined into the client bundle, so a database/Redis/Mongo connection URL ships directly to every visitor', helpUri: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser' },
  // CI
  GHA001: { id: 'GHA001', category: 'security', severity: 'high', message: 'Secrets may be echoed in GitHub Actions workflow', fix: 'Do not print secrets to logs; remove echo/printf of secrets' },
  
  // Next.js JWT/Cookie security rules  
  NEXT007: { id: 'NEXT007', category: 'security', severity: 'high', message: 'JWT token exposed in Next.js API response', fix: 'Use httpOnly cookies instead of returning tokens in JSON', impact: 'JWT tokens in API responses can be stolen via XSS and used for session hijacking' },
  NEXT008: { id: 'NEXT008', category: 'security', severity: 'medium', message: 'Missing security headers in Next.js API route', fix: 'Add security headers like X-Content-Type-Options, X-Frame-Options', impact: 'Missing security headers expose the application to various client-side attacks' },
  NEXT009: { id: 'NEXT009', category: 'security', severity: 'high', message: 'Unsafe redirect in Next.js API route', fix: 'Validate redirect URLs against allowlist', impact: 'Open redirects can be used for phishing attacks and credential theft', helpUri: 'https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet' },
  NEXT010: { id: 'NEXT010', category: 'security', severity: 'medium', message: 'CORS configuration too permissive', fix: 'Restrict CORS to specific origins instead of using wildcard', impact: 'Overly permissive CORS allows malicious sites to make requests on behalf of users', helpUri: 'https://developer.mozilla.org/docs/Web/HTTP/CORS' },
  NEXT011: { id: 'NEXT011', category: 'security', severity: 'high', message: 'Environment variable leaked in client-side code', fix: 'Use NEXT_PUBLIC_ prefix only for truly public variables', impact: 'Server-side environment variables exposed to client reveal sensitive configuration', helpUri: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser' },

  // Next.js routing & structure (experimental P5)
  NEXT201: { id: 'NEXT201', category: 'links', severity: 'low', message: 'Missing 404/not-found page', fix: 'Add pages/404.tsx (Pages Router) or app/not-found.tsx (App Router)', helpUri: 'https://nextjs.org/docs/app/api-reference/file-conventions/not-found', impact: 'Improves UX and SEO by handling missing routes gracefully' },
  NEXT202: { id: 'NEXT202', category: 'links', severity: 'low', message: 'Missing error boundary page', fix: 'Add pages/_error.tsx (Pages Router) or app/error.tsx (App Router)', helpUri: 'https://nextjs.org/docs/app/building-your-application/routing/error-handling', impact: 'Prevents blank screens and surfaces friendly errors to users' },
  NEXT203: { id: 'NEXT203', category: 'links', severity: 'low', message: 'Missing _document.tsx while using next/head or next/script', fix: 'Add pages/_document.tsx when customizing <Head> or <Script> in Pages Router', helpUri: 'https://nextjs.org/docs/pages/building-your-application/routing/custom-document', impact: 'Ensures consistent <html>/<body> structure and script handling in Pages Router' },
  NEXT205: { id: 'NEXT205', category: 'security', severity: 'medium', message: 'API route may be accessible without authentication', fix: 'Require auth (NextAuth getServerSession/JWT/cookie checks) for sensitive endpoints', helpUri: 'https://next-auth.js.org/configuration/nextjs#api-routes', impact: 'Unauthenticated access to sensitive APIs can leak data or allow abuse' },
  NEXT208: { id: 'NEXT208', category: 'security', severity: 'medium', message: 'router.push() to external URL', fix: 'Validate and restrict redirect targets to an allowlist or same-origin', helpUri: 'https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet', impact: 'Open redirects facilitate phishing and credential theft' },
  NEXT209: { id: 'NEXT209', category: 'security', severity: 'medium', message: 'API route missing HTTP method validation', fix: 'Validate req.method in Pages API or export method handlers (GET/POST/...) in App Router', helpUri: 'https://nextjs.org/docs/app/building-your-application/routing/route-handlers', impact: 'Accepting unintended methods broadens attack surface and leads to undefined behavior' },
  NEXT210: { id: 'NEXT210', category: 'security', severity: 'high', message: 'Server secret serialized to client props (leak risk)', fix: 'Do not pass secrets in getServerSideProps/getStaticProps props; keep server-only or use secure cookies', helpUri: 'https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props#caveats', impact: 'Secrets sent via props are exposed to the browser and can be exfiltrated' },
  NEXT216: { id: 'NEXT216', category: 'security', severity: 'high', message: 'App Router page/layout types params/searchParams as a plain object (Next 15 requires a Promise)', fix: 'Type the prop as Promise<{...}> and await it before use', helpUri: 'https://nextjs.org/docs/app/api-reference/file-conventions/page#params-optional', impact: 'Next 15 makes params/searchParams async; synchronous typing silently returns a thenable at runtime' },
  NEXT217: { id: 'NEXT217', category: 'security', severity: 'high', message: "React hook used in a component file without the 'use client' directive", fix: "Add 'use client'; at the very top of the file", helpUri: 'https://nextjs.org/docs/app/building-your-application/rendering/client-components', impact: 'Hooks in Server Components fail the Next build; the file needs the client directive to render on the browser' },
  NEXT218: { id: 'NEXT218', category: 'security', severity: 'low', message: 'reactStrictMode: false disables an important dev-time correctness check', fix: 'Remove the override or set reactStrictMode: true', helpUri: 'https://react.dev/reference/react/StrictMode', impact: 'Disabling Strict Mode masks double-invocation bugs and deprecated API warnings Next would otherwise catch' },
  NEXT219: { id: 'NEXT219', category: 'security', severity: 'low', message: 'experimental.serverActions: true uses the Next 13 shape and is ignored in Next 14/15', fix: 'Remove the flag; Server Actions are stable in Next 14. Use the object form only if you need allowedOrigins/bodySizeLimit', helpUri: 'https://nextjs.org/docs/app/api-reference/next-config-js/serverActions', impact: 'Stale experimental flags give a false sense that something is configured when it is not' },

  // 3.1 additions — React anti-patterns, module hygiene, agent tooling,
  // and extra security heuristics. Modular rules in src/rules/* are the
  // source of truth; these entries exist so the legacy registry stays in sync.
  REACT001: { id: 'REACT001', category: 'development', severity: 'medium', message: 'Array index used as React `key`', fix: 'Use a stable id from the data', helpUri: 'https://react.dev/learn/rendering-lists#why-does-react-need-keys' },
  REACT002: { id: 'REACT002', category: 'development', severity: 'high', message: 'Event handler invoked at render time (onClick={fn()})', fix: 'Pass the function reference: onClick={fn}' },
  REACT003: { id: 'REACT003', category: 'development', severity: 'high', message: 'State mutated in place before setter call', fix: 'Produce a new value (spread/map) before calling the setter' },
  REACT004: { id: 'REACT004', category: 'development', severity: 'medium', message: 'useEffect closes over a state value without listing it as a dependency', fix: 'Add the value to the dependency array or use the functional setter form' },
  REACT005: { id: 'REACT005', category: 'development', severity: 'high', message: 'useEffect starts a timer/listener without returning a cleanup', fix: 'Return a cleanup that clears the timer/listener' },
  REACT006: { id: 'REACT006', category: 'development', severity: 'medium', message: 'useEffect issues fetch without an AbortController signal', fix: 'Pass an AbortController signal and call abort() in cleanup' },
  REACT007: { id: 'REACT007', category: 'development', severity: 'high', message: 'Async function passed directly to useEffect', fix: 'Declare an async function inside the effect and call it' },
  REACT008: { id: 'REACT008', category: 'development', severity: 'medium', message: 'useState(expensive()) runs the initializer on every render', fix: 'Pass a function: useState(() => expensive())' },
  REACT009: { id: 'REACT009', category: 'development', severity: 'high', message: 'React hook called conditionally', fix: 'Call hooks at the top level of the component, unconditionally' },
  REACT010: { id: 'REACT010', category: 'development', severity: 'medium', message: 'ref.current assigned during render', fix: 'Mutate refs inside handlers or effects, not during render' },
  REACT011: { id: 'REACT011', category: 'security', severity: 'high', message: 'JWT / bearer token stored in localStorage or sessionStorage', fix: 'Store the token in an HttpOnly cookie set by the server' },

  SEC021: { id: 'SEC021', category: 'security', severity: 'medium', message: 'Error stack serialized into HTTP response body', fix: 'Return a generic message; log the stack server-side only' },
  SEC022: { id: 'SEC022', category: 'security', severity: 'medium', message: 'Silent .catch on DB/fetch returns stub data', fix: 'Log the error and either rethrow or surface a real failure state' },
  SEC023: { id: 'SEC023', category: 'security', severity: 'high', message: 'Weak hash (md5/sha1) used for a password or token', fix: 'Use bcrypt/argon2/scrypt for passwords; HMAC-SHA256 for tokens' },
  SEC024: { id: 'SEC024', category: 'security', severity: 'high', message: 'Math.random() used to produce a token/session id/nonce', fix: 'Use crypto.randomUUID() or crypto.randomBytes()' },
  SEC025: { id: 'SEC025', category: 'security', severity: 'high', message: 'Open redirect: redirect()/router.push() fed directly from user input', fix: 'Validate the target against a same-origin allowlist' },
  SEC026: { id: 'SEC026', category: 'security', severity: 'high', message: 'child_process called with a string containing user input', fix: 'Use execFile with an arg array; validate inputs' },
  SEC027: { id: 'SEC027', category: 'security', severity: 'high', message: 'File path built from user input without a path-traversal guard', fix: 'Resolve the joined path and assert it starts with the allowed root' },
  SEC028: { id: 'SEC028', category: 'security', severity: 'high', message: 'Auth token stored in localStorage or sessionStorage', fix: 'Use an HttpOnly cookie set by the server' },
  SEC029: { id: 'SEC029', category: 'security', severity: 'high', message: 'Webhook handler never verifies an incoming signature before mutating state', fix: 'Call stripe.webhooks.constructEvent / svix.verify / timingSafeEqual(createHmac(...)) before trusting the body' },
  SEC030: { id: 'SEC030', category: 'security', severity: 'high', message: 'fetch() target is user-controlled in a server route — potential SSRF', fix: 'Validate the URL against a hostname/IP allowlist before fetching' },
  SEC031: { id: 'SEC031', category: 'security', severity: 'medium', message: 'Password/token compared with === instead of timingSafeEqual', fix: 'Use crypto.timingSafeEqual for secret comparisons' },

  NEXT220: { id: 'NEXT220', category: 'security', severity: 'high', message: 'window access inside a Server Component', fix: "Move browser access into a 'use client' component" },
  NEXT221: { id: 'NEXT221', category: 'security', severity: 'high', message: "Client Component imports a server-only module (fs, pg, better-sqlite3, @prisma/client, ...)", fix: 'Move DB / fs access into a Server Component or Route Handler' },
  NEXT222: { id: 'NEXT222', category: 'security', severity: 'medium', message: 'Server Component imports a client-only state library (zustand/jotai/recoil/valtio)', fix: "Move stateful logic into a 'use client' component" },
  NEXT223: { id: 'NEXT223', category: 'security', severity: 'high', message: 'Route file uses `export default` instead of named GET/POST/...', fix: 'Rename the default export to a method name (GET, POST, ...)' },
  NEXT224: { id: 'NEXT224', category: 'development', severity: 'low', message: '<a href="/internal"> used instead of <Link>', fix: 'Import Link from next/link for same-origin navigation' },
  NEXT225: { id: 'NEXT225', category: 'security', severity: 'medium', message: '<form method="POST" action="/api/..."> without CSRF or Server Action', fix: 'Use a Server Action or add CSRF middleware' },

  MOD001: { id: 'MOD001', category: 'development', severity: 'medium', message: 'Module-level side effect runs at import time', fix: 'Move the side-effect inside a function' },
  MOD002: { id: 'MOD002', category: 'development', severity: 'low', message: 'Async function body contains no await (unnecessary wrapper)', fix: 'Drop the async keyword if nothing is awaited' },
  MOD003: { id: 'MOD003', category: 'security', severity: 'medium', message: 'Silent .catch on DB/fetch hides real errors', fix: 'Log the error or rethrow' },
  MOD004: { id: 'MOD004', category: 'development', severity: 'low', message: 'High density of `: any` annotations in a single file', fix: 'Narrow the types (unknown, generics, unions)' },

  CC001: { id: 'CC001', category: 'security', severity: 'high', message: 'Secret literal inside .claude/settings*.json', fix: 'Move the value out of the committed settings; rotate if already pushed' },
  CC002: { id: 'CC002', category: 'security', severity: 'high', message: 'Claude Code hook uses unquoted variable in a destructive command', fix: 'Quote every $VAR expansion' },
  CC003: { id: 'CC003', category: 'security', severity: 'high', message: 'Claude Code hook pipes remote content to a shell (curl | sh)', fix: 'Download, verify checksum, then execute' },
  CC004: { id: 'CC004', category: 'security', severity: 'high', message: 'Secret-shaped string inside CLAUDE.md / .claude/agents/*.md', fix: 'Remove the literal and rotate if committed' },
  CC005: { id: 'CC005', category: 'security', severity: 'high', message: 'MCP server config exposes a secret in its env block', fix: "Resolve ${VAR} from the shell env instead of committing the literal" },
  CC006: { id: 'CC006', category: 'security', severity: 'high', message: 'Secret-shaped string inside .cursorrules / .windsurfrules / .aiderconfig', fix: 'Remove the secret from the rules file' },
  CC007: { id: 'CC007', category: 'security', severity: 'low', message: 'Claude Code session transcripts or TODO state committed', fix: 'Add .claude/todos/ and .claude/history/ to .gitignore' },
  CC008: { id: 'CC008', category: 'security', severity: 'medium', message: 'Prompt-injection marker inside agent rules / memory file', fix: 'Remove lines that try to override the agent behavior' }
};


