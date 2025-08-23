## 1.0.0 — 2025-08-23
-
## 1.0.1 — 2025-08-23

### Fixed
- Avoid runtime crash when installed globally by lazily requiring TypeScript in AST scanner. If `typescript` is not present, AST-based checks are skipped gracefully instead of failing.
- Move `typescript` to runtime dependencies to support global installs.

Initial stable release.

### Profiles
- React/Next.js
- Vue.js
- Python

### Security (JS/TS/Next)
- Secrets and credentials: API keys (OpenAI/Stripe/AWS/GitHub), Supabase keys/URLs, DB URLs, hardcoded passwords, entropy-based detection (SEC018)
- Code execution and injection: `eval()`, `dangerouslySetInnerHTML`, React.createElement injection (SEC019), dynamic import with user input (NEXT004)
- Next.js SSR/API: secrets in `getServerSideProps/getStaticProps` (NEXT006), API route validation heuristic (NEXT003)
- Logging: potential secrets printed to logs (LOG001)
- Network hygiene: fetch/axios without timeout/AbortController (JSNET001); cookie flags (COOKIE001)
- AST-assisted JS/TS analysis for higher precision on eval/innerHTML/env fallback/fetch

### Security (Python)
- `exec`/`eval`, `subprocess(shell=true)`, unsafe `yaml.load`, `pickle`, `requests(verify=false)`
- Framework settings: `DEBUG=True`, permissive `ALLOWED_HOSTS`; requests without timeout (PYNET001)

### Accessibility
- Images without alt and missing width/height (A11Y001, A11Y006/007)
- Non-semantic clicks on `<div>` or Vue `@click` without roles (A11Y004)
- Next.js guidance: external `<img>` usage (NEXT005)

### Environment & configuration
- `.env` hygiene: not ignored, secrets in `.env`, missing `.env.example`
- Drift detection between `.env` and `.env.example` (ENV007)
- Config via `ubon.config.(json|js)` and `package.json.ubon`
- Baseline and suppressions with stable fingerprints (inline: `ubon-disable-file`, `ubon-disable-next-line RULEID`)
- Changed-files mode and `--git-changed-since`

### Links & crawling
- External link reachability via HTTP(S) HEAD with timeouts (LINK002)
- Internal crawler (opt-in, Puppeteer) for broken internal links/routes (LINK003)

### Dependency & supply chain
- OSV.dev advisories for npm and PyPI (OSV001)
- Git history secret scanning (regex + entropy)

### DX & output
- Deterministic, agent-friendly JSON (schemaVersion/toolVersion), redaction, and machine-actionable `fixEdits`
- SARIF 2.1.0 output for GitHub code scanning
- `--fast` mode to skip OSV, link checks, and crawler

### CLI
- Core: `--json`, `--sarif`, `--output`, `--fail-on`, `--min-confidence`, `--enable-rule`, `--disable-rule`, `init`
- Baseline: `--baseline`, `--update-baseline`, `--no-baseline`
- Scope: `--changed-files`, `--git-changed-since`, `--git-history-depth`
- Profiles: `--profile auto|react|next|vue|python`
- Crawler: `--crawl-internal`, `--crawl-start-url`, `--crawl-depth`, `--crawl-timeout`
- Fixes: `--fix-dry-run`, `--apply-fixes`

### Notes
- External link checks are timeout-guarded; internal crawling remains opt-in.
- Heuristics aim to minimize noise; tune with confidence thresholding, rule enable/disable, and baselines.
