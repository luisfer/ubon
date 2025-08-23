## Rules Glossary

Security (JS/TS)
- SEC001: Potential API key or secret token exposed
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
- SEC014: OpenAI API key exposed
- SEC015: Console statement found (may leak sensitive info)
- SEC016: Use of eval() detected (security risk)
- SEC017: dangerouslySetInnerHTML usage (XSS risk)
- SEC018: High-entropy string literal (possible secret)
- JSNET001: HTTP request without timeout/retry policy
- COOKIE001: Set-Cookie missing HttpOnly/Secure/SameSite
- OSV001: Vulnerable dependency detected

Accessibility
- A11Y001: Image without alt attribute
- A11Y002: Input without label or aria-label
- A11Y003: Empty button without aria-label
- A11Y004: Div with onClick (not keyboard accessible)
- A11Y005: Link without href attribute
- A11Y006: Image missing width/height attributes
- A11Y007: next/image used without width and height
- NEXT001: next/link used without anchor or child text (legacyBehavior)
- NEXT002: In-page <a> used for client navigation; prefer next/link

Environment
- ENV001: .env file may not be in .gitignore
- ENV002: Potential API key in .env file
- ENV004: Secret value in .env file
- ENV005: Supabase credentials in .env
- ENV006: Missing .env.example file for documentation

Links
- LINK001: Link checking requires puppeteer installation
- LINK002: External link unreachable or 4xx/5xx

Python
- PYSEC001: Potential API key exposed
- PYSEC002: Use of exec() detected
- PYSEC003: Use of eval() detected
- PYSEC004: subprocess with shell=True
- PYSEC005: yaml.load() unsafe without Loader
- PYSEC006: Insecure pickle usage
- PYSEC007: TLS verification disabled
- PYSEC009: DEBUG=True in settings
- PYSEC010: ALLOWED_HOSTS includes *
- PYNET001: requests call without timeout


