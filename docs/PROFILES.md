## Profiles: Lovable / React/Next / Python

Selection
- **auto** (default): detects Lovable apps (Vite+Supabase+React+Tailwind), Python if any `*.py` files, otherwise JS/TS
- **lovable**: React + Vite + Supabase + Tailwind apps (auto-detected)
- **react**: JS/TS web projects (React)
- **next**: JS/TS Next.js apps (same static rules as react today)
- **vue**: JS/TS Vue apps (scanned with JS/TS rules over `.vue` files)
- **python**: Python projects
- **rails**: Ruby on Rails apps (experimental)

Scanners by profile
- **lovable**: LovableSupabaseScanner, ViteScanner, ReactSecurityScanner, SecurityScanner, AST Security Scanner, AccessibilityScanner, DevelopmentScanner, EnvScanner, IacScanner, OSVScanner, LinkScanner, optional GitHistoryScanner
- **react/next/vue**: SecurityScanner, AST Security Scanner, AccessibilityScanner, EnvScanner, OSVScanner, LinkScanner, optional GitHistoryScanner (via `--git-history-depth`), optional InternalCrawler (via `--crawl-internal`)
- **python**: PythonSecurityScanner, EnvScanner, OSVScanner, LinkScanner, optional GitHistoryScanner
- **rails**: RailsSecurityScanner, EnvScanner, OSVScanner (experimental)

Differences
- **Lovable**: All JS/TS checks PLUS specialized Supabase security (6 rules for RLS, keys, auth, SQL injection, policies, storage), Vite security (3 rules for env vars, dev-only code, unsafe imports), Tailwind security (className injection). See `docs/LOVABLE.md` for details.
- **JS/TS**: checks API keys, Supabase, eval/dangerous HTML, console leaks, axios/fetch timeout heuristics, cookie attributes, Next-specific a11y (img/next/image width/height, Link usage), external link reachability, OSV (npm), AST-based precision for eval/innerHTML/env fallbacks/fetch
- **Python**: checks exec/eval, subprocess shell=True, yaml.load, pickle, requests.verify=False, DEBUG/ALLOWED_HOSTS, requests timeout presence, external link reachability, OSV (PyPI)
- **Rails**: checks SQL injection, shell execution, YAML loading, unescaped output, mass assignment (experimental)

Notes
- LinkScanner currently checks external URLs via HTTP(S) HEAD with timeouts, independent of profile.
- Internal crawling can be added as opt-in in future (Puppeteer for JS, requests/bs4 for Python).

