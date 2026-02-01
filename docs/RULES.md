## Rules Glossary

### Confidence Scale

Each finding includes a confidence score (0.0-1.0) indicating how likely it is to be a true positive:

| Score | Level | Meaning |
|-------|-------|---------|
| 0.9-1.0 | Very High | AST-confirmed or exact pattern match. Almost certainly a real issue. |
| 0.8-0.9 | High | Strong pattern match with context. Very likely a real issue. |
| 0.7-0.8 | Medium | Pattern match that may need verification. Likely a real issue. |
| 0.5-0.7 | Lower | Heuristic detection. Review recommended before acting. |

Use `--min-confidence 0.8` to filter out lower-confidence findings, or `--detailed` to see all findings including noisy ones.

Each finding also includes a `confidenceReason` field explaining why that confidence level was assigned.

---

### Vibe Code Detection (v2.0.0)

Rules for detecting common AI-generated code issues:

- VIBE001: Import from non-existent package (possible hallucination) — detects imports from modules not in package.json
- VIBE002: Repeated code block detected (possible copy-paste artifact) — identifies duplicated 5+ line blocks
- VIBE003: Incomplete implementation detected (placeholder or stub) — catches "Not implemented" errors, placeholder strings, TODO stubs
- VIBE004: Exported symbol appears unused in the codebase — finds exports never imported elsewhere

### Development

Rules for catching common development issues:

- DEV001: TODO/FIXME comments detected
- DEV002: "Not implemented" stubs and placeholder functions
- DEV003: Placeholder URLs in API endpoints (`localhost`, `example.com`)
- DEV004: Hardcoded mock/example data in responses
- DEV005: Empty returns or unimplemented functions

### Security (JS/TS)
- COOKIE001: Set-Cookie missing HttpOnly/Secure/SameSite ([docs](https://owasp.org/www-community/controls/SecureCookieAttributes))
- COOKIE002: JWT token exposed in client-side cookie without security flags ([docs](https://owasp.org/www-community/controls/SecureCookieAttributes))
- COOKIE003: Sensitive data returned in JSON response (potential token leak)
- COOKIE004: Cookie used without domain/path restrictions
- JSNET001: HTTP request without timeout/retry policy ([docs](https://developer.mozilla.org/docs/Web/API/AbortController))
- LOG001: Potential secret logged to console/logger ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html))
- LOVABLE001: Supabase table accessed without RLS policy validation ([docs](https://supabase.com/docs/guides/auth/row-level-security))
- LOVABLE002: Supabase credentials hardcoded in source code ([docs](https://vitejs.dev/guide/env-and-mode.html))
- LOVABLE003: Anonymous authentication enabled without RLS policy validation ([docs](https://supabase.com/docs/guides/auth/auth-anonymous))
- LOVABLE004: Potential SQL injection in Supabase query - uses string interpolation ([docs](https://supabase.com/docs/reference/javascript/using-filters))
- LOVABLE005: Weak RLS policy pattern detected ([docs](https://supabase.com/docs/guides/auth/row-level-security#policies))
- LOVABLE006: Supabase storage access without proper validation ([docs](https://supabase.com/docs/guides/storage/security/access-control))
- OSV001: Vulnerable dependency detected
- SEC001: Potential API key or secret token exposed ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html))
- SEC002: Supabase URL hardcoded (should use env var)
- SEC003: Supabase anon key hardcoded (JWT token pattern)
- SEC004: Supabase URL hardcoded in variable
- SEC005: Supabase key hardcoded in variable
- SEC006: Hardcoded password detected
- SEC007: Database URL hardcoded
- SEC008: Environment variable with hardcoded fallback
- SEC009: AWS Access Key ID exposed
- SEC010: Google OAuth token exposed
- SEC011: GitHub token exposed
- SEC012: Stripe live secret key exposed
- SEC013: Stripe live publishable key exposed
- SEC014: OpenAI API key exposed ([docs](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html))
- SEC015: Console statement found (may leak sensitive info)
- SEC016: Use of eval() detected (security risk) ([docs](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/eval))
- SEC017: dangerouslySetInnerHTML usage (XSS risk) ([docs](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html))
- SEC018: High-entropy string literal (possible secret) ([docs](https://owasp.org/Top10/A02_2021-Cryptographic_Failures))
- SEC019: React component injection via createElement
- TAILWIND001: Dynamic className with unvalidated input - may allow CSS injection ([docs](https://tailwindcss.com/docs/content-configuration#dynamic-class-names))
- VITE001: Environment variable without VITE_ prefix may expose secrets to client ([docs](https://vitejs.dev/guide/env-and-mode.html#env-variables))
- VITE002: Development-only code without production fallback ([docs](https://vitejs.dev/guide/env-and-mode.html#modes))
- VITE003: Unsafe dynamic import with user input - potential path traversal ([docs](https://vitejs.dev/guide/features.html#dynamic-import))

### Next.js
- NEXT001: next/link used without anchor or child text (legacyBehavior)
- NEXT002: In-page <a> used for client navigation; prefer next/link
- NEXT003: Next.js API route uses request params without validation
- NEXT004: Dynamic import with user-controlled path
- NEXT005: External <img> used in Next.js app (consider next/image)
- NEXT006: Sensitive data exposed via getStaticProps/getServerSideProps
- NEXT007: JWT token exposed in Next.js API response
- NEXT008: Missing security headers in Next.js API route
- NEXT009: Unsafe redirect in Next.js API route ([docs](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet))
- NEXT010: CORS configuration too permissive ([docs](https://developer.mozilla.org/docs/Web/HTTP/CORS))
- NEXT011: Environment variable leaked in client-side code ([docs](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser))
- NEXT210: Server secret serialized to client props (leak risk) ([docs](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props#caveats))

### Accessibility
- A11Y001: Image without alt attribute ([docs](https://webaim.org/techniques/alttext/))
- A11Y002: Input without label or aria-label ([docs](https://web.dev/labels-and-text-alternatives/))
- A11Y003: Empty button without aria-label ([docs](https://dequeuniversity.com/rules/axe/4.7/button-name))
- A11Y004: Div with onClick (not keyboard accessible) ([docs](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Roles/button_role))
- A11Y005: Link without href attribute ([docs](https://dequeuniversity.com/rules/axe/4.7/link-name))
- A11Y006: Image missing width/height attributes ([docs](https://web.dev/optimize-cls/))
- A11Y007: next/image used without width and height ([docs](https://nextjs.org/docs/pages/api-reference/components/image))

### Environment
- ENV001: .env file may not be in .gitignore
- ENV002: Potential API key in .env file
- ENV004: Secret value in .env file
- ENV005: Supabase credentials in .env
- ENV006: Missing .env.example file for documentation
- ENV007: Environment variable drift between .env and .env.example

### Links
- LINK001: Link checking requires puppeteer installation
- LINK002: External link unreachable or 4xx/5xx
- LINK003: Internal link or resource broken

### Python
- PYNET001: requests call without timeout
- PYSEC001: Potential API key exposed
- PYSEC002: Use of exec() detected
- PYSEC003: Use of eval() detected
- PYSEC004: subprocess with shell=True
- PYSEC005: yaml.load() unsafe without Loader
- PYSEC006: Insecure pickle usage
- PYSEC007: TLS verification disabled
- PYSEC009: DEBUG=True in settings
- PYSEC010: ALLOWED_HOSTS includes *

### Vue
- VUE001: v-html binding (XSS risk)

### Docker/CI
- DOCKER001: Dockerfile runs as root (USER root or no USER)
- DOCKER002: Secrets defined via ENV in Dockerfile
- DOCKER003: Docker base image uses :latest tag
- DOCKER004: apt-get install without cleaning apt cache
- GHA001: Secrets may be echoed in GitHub Actions workflow

### Rails (experimental)
- NEXT201: Missing 404/not-found page ([docs](https://nextjs.org/docs/app/api-reference/file-conventions/not-found))
- NEXT202: Missing error boundary page ([docs](https://nextjs.org/docs/app/building-your-application/routing/error-handling))
- NEXT203: Missing _document.tsx while using next/head or next/script ([docs](https://nextjs.org/docs/pages/building-your-application/routing/custom-document))
- NEXT205: API route may be accessible without authentication ([docs](https://next-auth.js.org/configuration/nextjs#api-routes))
- NEXT208: router.push() to external URL ([docs](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards_Cheat_Sheet))
- NEXT209: API route missing HTTP method validation ([docs](https://nextjs.org/docs/app/building-your-application/routing/route-handlers))
