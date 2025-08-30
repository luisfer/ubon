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

## 1.0.2 — 2025-08-23

### Changed
- CLI polish: lotus emoji branding in descriptions and consistent version read from package.json.

### Notes
- Cosmetic/non-breaking update to improve CLI identity.

## 1.0.3 — 2025-08-23

### Changed
- CLI styling and badges refreshed; minor cosmetic updates.

### Notes
- Cosmetic/non-breaking update; no behavior changes.

## 1.0.4 — 2025-08-24

### Added
- Human output triage header with severity-first summary (non-breaking; JSON/SARIF unchanged)
- Focus filters for human output: `--focus-critical`, `--focus-security`, `--focus-new`, and `--detailed`

### Changed (non-disruptive)
- SEC018 noise reduction: context/file-aware ignores (CSS/Tailwind/globs/data URIs/UUID), pattern-first detection for `sk-`/JWT/DB URLs/etc., higher entropy threshold
- Runtime default minConfidence=0.8 for human runs (non-JSON) when not provided (does not change config or JSON/SARIF)

### Tests & Docs
- Added tests covering SEC018 false positives and true positives
- Updated CLI docs with new flags and examples

This patch focuses on triage-first UX and noise reduction without changing schema or defaults that would break existing workflows.

## 1.1.0 — 2025-08-25

### Added
- Colorized, branded output with lotus (🪷) and `--color` flag
- Result organization with `--group-by`, `--min-severity`, `--max-issues`
- Code context (`--show-context`) and explanations (`--explain`)
 - Confidence display (`--show-confidence`) in human output
- Inline suppressions: `// ubon-disable-next-line RULEID [reason]` with `--show-suppressed`/`--ignore-suppressed`
- OSV caching (24h TTL) with `--clear-cache`, `--no-cache`, and `ubon cache` command
- Next.js security rules: JWT in responses (NEXT007), missing security headers (NEXT008), unsafe redirects (NEXT009), permissive CORS (NEXT010), client env leaks (NEXT011)
 - CI gate: `--base-sha` (fail only on new issues vs base)
 - Watch mode: `--watch` (incremental re-scan; use with `--fast`)
 - Create PR: `--create-pr` after `--apply-fixes`
 - VS Code extension (MVP): diagnostics + quick fixes
 - Experimental Next.js routing/structure rules (NEXT201–NEXT209)

 ### Rails 
 
 - Rails profile (experimental): SQLi in where, system/backticks, YAML.load, html_safe in ERB

### Autofixes (safe)
- Accessibility: add `alt` to `<img>`, `aria-label` to `<input>`, add `role="button" tabIndex={0}` to clickable `<div>`, convert `<a>` without `href` to `<button>`
- Security: redact secret-like tokens in `console.*` calls; add `HttpOnly; Secure` to JWT cookies
 - Env/config: remove hardcoded fallbacks from `process.env.X || '...'`
 - Networking: suggest `{ signal }` on `fetch(...)` (AbortController)

### Performance
- Repeat scans ~30–40% faster when OSV cache is warm

### Docs
- README streamlined with AI Assistants workflow; feature matrix added in `docs/FEATURES.md`; CLI cross-links.
- P5 rules documented as experimental with enable/disable examples.

### Notes
- All changes are non-breaking and gated behind flags; JSON/SARIF schema remains stable

## 1.1.1 — 2025-08-25

### Changed
- Default human run applies AI-friendly preset: enables show-context, explain, severity grouping, caps max-issues to 15 by default (overridable). `--ai-friendly` still forces JSON + the same human-friendly settings for agent use.
- README: added TL;DR block at the top with quick install/run.
 - New flag: `--pr-comment` to emit a Markdown summary for PR reviews.

### Notes
- Non-breaking; JSON/SARIF unchanged.

## 1.1.3 — 2025-08-29

### Added
- **Interactive Mode**: `--interactive` flag for step-by-step issue walkthrough with explanations, context, and fix options
- **Beautiful CLI Color System**: Lotus-inspired severity bands with enhanced visual triage
  - Critical: Deep lotus red, High: Coral pink, Medium: Amber, Low: Lotus green
  - Consistent `🪷` lotus branding throughout all scanner completion messages
- **Modular Rules Architecture**: New `/src/rules/` structure with category-based organization for better maintainability
- **Development Scanner**: New DEV001-005 rules specifically for AI-generated code issues
  - DEV001: TODO/FIXME comments detection
  - DEV002: "Not implemented" stubs and placeholder functions
  - DEV003: Placeholder URLs in API endpoints (`localhost`, `example.com`)
  - DEV004: Hardcoded mock/example data in responses
  - DEV005: Empty returns or unimplemented functions

### Enhanced
- **Triage Header**: Beautiful colored severity bands replace basic text output
- **Success Messages**: Enhanced with lotus theming ("🪷 No issues found! Your app is blooming beautifully! ✨")
- **Scanner Progress**: All completion messages now use `🪷` lotus emoji for consistent branding

### Technical
- Made `printResults()` async to support interactive mode
- Added new `ScanOptions.interactive` property
- Enhanced `getSeverityBand()` method with lotus-inspired color palette
- Backward compatibility maintained for all existing features

### Notes
- Interactive mode provides guided issue resolution perfect for AI-assisted debugging
- Development scanner addresses the "vibe-coded" app debugging crisis
- All changes are non-breaking; JSON/SARIF output unchanged

## 1.1.2 — 2025-08-27

### Added
- Compact table output: `--format table` for skimmable terminal triage.
- Per-file result cache for faster repeat scans (disable with `--no-result-cache`).
- Experimental P5 rule: NEXT210 — detects server→client secret bleed via SSR props.

### Docs
- CLI docs updated (format=table, result cache, pr-comment).
- New `docs/COMPARISON.md` outlining Ubon vs ESLint vs npm audit.
