## Profiles: React/Next vs Python

Selection
- auto (default): detects Python if any `*.py` files, otherwise JS/TS
- react: JS/TS web projects (React)
- next: JS/TS Next.js apps (same static rules as react today)
- vue: JS/TS Vue apps (scanned with JS/TS rules over `.vue` files)
- python: Python projects

Scanners by profile
- react/next/vue: SecurityScanner, AST Security Scanner, AccessibilityScanner, EnvScanner, OSVScanner, LinkScanner, optional GitHistoryScanner (via `--git-history-depth`), optional InternalCrawler (via `--crawl-internal`)
- python: PythonSecurityScanner, EnvScanner, OSVScanner, LinkScanner, optional GitHistoryScanner

Differences
- JS/TS: checks API keys, Supabase, eval/dangerous HTML, console leaks, axios/fetch timeout heuristics, cookie attributes, Next-specific a11y (img/next/image width/height, Link usage), external link reachability, OSV (npm), AST-based precision for eval/innerHTML/env fallbacks/fetch
- Python: checks exec/eval, subprocess shell=True, yaml.load, pickle, requests.verify=False, DEBUG/ALLOWED_HOSTS, requests timeout presence, external link reachability, OSV (PyPI)

Notes
- LinkScanner currently checks external URLs via HTTP(S) HEAD with timeouts, independent of profile.
- Internal crawling can be added as opt-in in future (Puppeteer for JS, requests/bs4 for Python).

