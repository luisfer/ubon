## 3.0.0 — Modernization & AI-Era Edition — 2026-04-18

### 🎯 Major: AI-era detections, MCP server, Cursor hooks, deterministic output

This is a focused, breaking release. The toolchain is modernized
(Node 20+, ESLint 9 flat config, picocolors, glob 11, commander 13),
the rule pack now covers what AI assistants actually ship in 2026,
and Ubon can run as a Model Context Protocol server so the agent
itself can call it.

See [MIGRATION-v3.md](./MIGRATION-v3.md) for the upgrade checklist.

### ✨ New: AI-era rule pack (AI001–AI008)

- **AI001** Hardcoded LLM API key (OpenAI/Anthropic/Google/Groq/etc.)
- **AI002** Prompt injection sink (user input → system/user message)
- **AI003** System prompt / model config leaked to client bundle
- **AI004** Hardcoded vector-DB credential (Pinecone/Qdrant/Weaviate/Chroma)
- **AI005** MCP server config with literal secret
- **AI006** LLM tool/function handler with no auth or allowlist
- **AI007** Streaming LLM endpoint missing auth + rate limit
- **AI008** Unbounded LLM call (no `max_tokens`/`maxOutputTokens`)

### ✨ New: Modern framework rule pack

- **NEXT212–215** Next 14/15 Server Actions (auth, validation, mass
  assignment, `use server` leaking into `use client`)
- **EDGE001–003** Edge runtime: Node-only API misuse, Wrangler secret
  hygiene, top-level `process.env` reads in middleware
- **SVELTE001–002** SvelteKit `+page.server` and `+server` checks
- **ASTRO001** Astro endpoints missing validation
- **REMIX001** Remix loaders / actions returning secrets
- **HONO001** Hono CORS / rate-limit hints
- **DRIZZLE001 / PRISMA001** raw SQL with user input

### ✨ New: AI-native integration

- **`ubon mcp`** — Model Context Protocol server exposing `ubon.scan`,
  `ubon.check`, `ubon.explain`, `ubon.preview-fixes`,
  `ubon.apply-fixes`. Ships as an optional dependency
  (`@modelcontextprotocol/sdk`). See [docs/MCP.md](./docs/MCP.md).
- **`ubon hooks install --cursor`** — drop-in `.cursor/hooks.json` plus
  shell scripts for `afterFileEdit` and `beforeSubmitPrompt`.
- **LSP polish** — `onDidChangeContent` debounce (500 ms), persistent
  cross-file results, `confidenceReason` in hover content.

### ✨ New: CLI ergonomics

- **`ubon doctor`** — environment diagnostic (Node, git, optional deps)
- **`--ndjson`** — one finding per line, ideal for streaming agents
- **`--quiet`** — suppress banners and contextual guidance
- **`--schema`** — print the JSON Schema for `--json` output and exit
- **`--allow-config-js`** — gate `ubon.config.js` (executes user code)
- **`ubon completion <bash|zsh|fish>`** — shell completion scripts
- **Update notifier** — opt-out via `UBON_DISABLE_UPDATE_NOTIFIER=1`
- **Homebrew formula** — `scripts/homebrew/ubon.rb` for the upcoming tap

### ✨ New: Output guarantees

- JSON output schema bumped to **`2.0.0`**, published at
  `docs/schema/ubon-finding.schema.json`.
- JSON and NDJSON outputs are **byte-for-byte deterministic** across
  runs (sorted keys, stable severity order, undefined fields stripped).
- SARIF: `partialFingerprints` is now emitted for every result; secret
  redaction goes through the centralized `redact()` utility shared
  with JSON / Markdown output.

### 🛠 Architecture

- **Single source of truth for `RuleCategory`** in `src/rules/types.ts`.
- **Reporters extracted** from the `UbonScan` orchestrator:
  `src/reporters/HumanReporter.ts`, `src/reporters/InteractiveReporter.ts`,
  `src/core/Posture.ts`.
- **Profile registry** in `src/core/profiles.ts` — adding a profile is
  now a config change, not a new scanner class.
- **Shared `FileSourceCache`** with `maxFileSize` (default 1 MiB) to
  avoid pathological regex backtracking on huge files.
- **ReDoS audit** — bounded multi-line patterns
  (`[\s\S]{0,N}?`) in the security and Rails scanners.
- **Crawler SSRF guard** — `--crawl-start-url` restricted to localhost
  by default; opt out with `UBON_ALLOW_REMOTE_CRAWL=1`.

### 🧹 Repo hygiene

- Removed `.tmp-cli-output.*`, `test-results.sarif`, empty
  `scripts/migrate-rules.js` and `src/rules/registry.ts`.
- Coverage gates raised on critical utilities (`redact`, `sarif`,
  `Posture`).
- New fixture-based integration tests for the AI scanner, framework
  scanner, NDJSON, schema dump, deterministic JSON, and a ReDoS
  regression test.
- CI matrix updated to Node 20 / 22 / 24; `npm publish --provenance`
  on release; Dependabot config added.

### ⚠️ Breaking changes

- **Node 20+** is required (Node 16 and 18 dropped).
- **`ubon guide`** removed.
- **JSON output schema** is `2.0.0`. Field set is unchanged but key
  ordering and the absence of `undefined` fields are now guaranteed.
- **`ubon.config.js`** is no longer loaded by default; pass
  `--allow-config-js` or set `UBON_ALLOW_CONFIG_JS=1`.
- **`chalk`** is no longer a runtime dependency (replaced by
  `picocolors`). User-visible output is unchanged.

### 🗑 Removed in v3.0.0 — scope cut

v3 narrows Ubon's focus to modern JS/TS web stacks (Next.js, React,
Vite, SvelteKit, Astro, Remix, Hono, Lovable). The following are gone:

- **`--profile python`** and the entire `PythonSecurityScanner`
  (`PYSEC001`–`PYSEC005`, `PYNET001`–`PYNET002`, plus the
  `python-security-scanner.ts` source and tests). Use
  [Bandit](https://bandit.readthedocs.io/),
  [Semgrep](https://semgrep.dev), or
  [`pip-audit`](https://pypi.org/project/pip-audit/) for Python.
- **`--profile rails`** and the `RailsSecurityScanner` (all `RAILS*`
  rules, `rails-security-scanner.ts`, and the Rails-faulty fixture
  app). Use [Brakeman](https://brakemanscanner.org).
- **`--profile vue`** and the Vue-specific rule `VUE001`
  (v-html XSS), plus the `vue-faulty` fixture app. Use
  [`eslint-plugin-vue`](https://eslint.vuejs.org).
- **`.py` auto-detection** in the `auto` profile. `auto` no longer
  glob-walks for Python files — it only flips between `lovable` and
  the JS baseline based on `package.json` and config files.
- All scanner glob patterns, rule `fileTypes`, and Cursor
  `.cursor/rules/ubon.mdc` defaults that previously included `vue`,
  `py`, or `rb` were updated to `svelte` / `astro` / dropped.

Selecting a removed profile via `--profile` exits with code `2` and
prints the suggested replacement plus a link to
[`MIGRATION-v3.md`](./MIGRATION-v3.md).

### 🪦 Deprecated (removal in v3.1)

- `--crawl-internal` (Puppeteer crawler) — high-maintenance, low signal.
- Loading `ubon.config.js` without `--allow-config-js` will hard-fail
  in v3.1; for now it errors with a clear migration message.

### 📚 Docs

- Consolidated from 13 pages to 8: new
  [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) (Cursor + Lovable +
  comparison) and [docs/ADVANCED.md](./docs/ADVANCED.md) (profiles +
  suppressions + baselines + output schemas + release policy).
- New [MIGRATION-v3.md](./MIGRATION-v3.md) and rewritten README.

---

## 2.0.0 — The Vibe Code Edition — 2026-02-01

### 🎯 Major: Vibe Code Detection

Added comprehensive detection for common AI-generated code issues, plus architectural improvements and Cursor integration.

#### New Rules: Vibe Code Detection (VIBE001-004)

- **VIBE001**: Hallucinated imports — detects imports from packages not in package.json
- **VIBE002**: Copy-paste artifacts — identifies repeated code blocks suggesting copy-paste without adaptation
- **VIBE003**: Incomplete implementations — catches placeholder strings, "Not implemented" errors, TODO stubs
- **VIBE004**: Orphaned exports — finds exported symbols never imported elsewhere

#### New Scanner

- **VibeScanner**: Cross-file analysis for AI-generated code patterns
  - Package.json dependency validation
  - Repeated block detection
  - Export/import graph analysis

### ✨ New Features

- **Security Posture Score**: 0-100 score with visual bar in human output
- **`--preview-fixes`**: Diff-like preview of auto-fixes before applying
- **`confidenceReason`**: Every finding now explains its confidence level
- **`ubon explain <rule>`**: New command to get detailed info about any rule
- **Cursor Integration**: `docs/CURSOR.md` guide and `.cursor/rules/` for Cursor users
- **All scanners exported**: Use any scanner programmatically via `import { VibeScanner } from 'ubon'`

### 🏗️ Architecture Improvements

- **Modular Security Rules**: SEC001-SEC017 migrated to individual files in `src/rules/security/`
- **SecurityScanner Refactor**: Now uses rule registry instead of hardcoded patterns
- **BaseScanner Caching**: Result caching utilities available to all scanners
- **CLI Refactor**: Shared logic extracted to `src/cli/shared.ts`
- **All scanners exported**: 15 scanners now available for programmatic use
- **Removed dead code**: Deleted empty `src/rules/registry.ts`

### 🐛 Bug Fixes

- Watch mode now debounces rapid file changes to prevent overlapping scans
- Scanners log file read errors when `--verbose` is enabled
- `--no-result-cache` flag now available on `check` command
- Fixed VIBE001 import detection regex for `from 'module'` syntax
- Fixed LSP server TextDocumentSyncKind import

### 📚 Documentation

- `docs/CURSOR.md`: Complete Cursor integration guide
- `.cursor/rules/ubon-development.mdc`: Cursor rules for Ubon contributors
- Updated `docs/RULES.md` with VIBE rules and confidence scale
- Updated `docs/CLI.md` with all flags including `--preview-fixes`, `--watch`, `explain` command
- Documented confidence scale (0.5-1.0) with explanations

### 🧪 Testing

- New test suite for SEC001-SEC017 modular rules
- Fixed regex lastIndex issues in security rules tests
- VibeScanner test coverage

### Breaking Changes

None. All changes are additive and backward-compatible.

### Notes

- Vibe rules enabled by default in `auto` profile
- Security posture score only appears in human output (JSON/SARIF unchanged)
- Cursor integration is optional but recommended for AI-assisted development

---

## 1.2.0 — The Lovable Edition — 2025-10-13

### 🎯 Major: Lovable App Support

Added comprehensive security scanning specifically for Lovable-generated applications (React + Vite + Supabase + Tailwind stack).

#### New Profile
- **`--profile lovable`**: Specialized scanning for Lovable apps
- **Auto-detection**: Automatically detects Lovable apps by stack signature (Vite + Supabase + React + Tailwind)
- Optimized for React + Vite + Supabase + Tailwind CSS applications

#### New Scanners & Rules

**Lovable Supabase Scanner** (6 new rules):
- **LOVABLE001**: Missing RLS Policy - validates actual RLS protection, not just existence
- **LOVABLE002**: Exposed Supabase Keys - detects hardcoded URLs and anon keys
- **LOVABLE003**: Anonymous Auth Without RLS - flags unprotected anonymous access
- **LOVABLE004**: SQL Injection in Supabase Queries - detects unsafe string interpolation
- **LOVABLE005**: Weak RLS Policy Patterns - identifies overly permissive policies
- **LOVABLE006**: Supabase Storage Access Control - validates file upload security

**Vite Scanner** (3 new rules):
- **VITE001**: Client-Side Environment Variable Exposure - catches non-VITE_ prefixed vars
- **VITE002**: Development-Only Code in Production - ensures proper fallbacks
- **VITE003**: Unsafe Dynamic Imports - prevents path traversal in dynamic imports

**Enhanced React Scanner**:
- **TAILWIND001**: Dynamic className Injection - detects CSS injection via Tailwind

### ✨ Polish & Improvements

- Added badges to README (npm version, downloads, coverage, license)
- Added comprehensive comparison table (Ubon vs ESLint vs npm audit vs Lovable Scanner)
- Fixed duplicate `prepublishOnly` in package.json
- Updated all version references from 1.1.3 to 1.2.0

### 📚 Documentation

- Created `docs/LOVABLE.md` - Complete Lovable integration guide with examples
- Updated `docs/RULES.md` with 10 new rules (detailed explanations + docs links)
- Updated `docs/FEATURES.md` with Lovable profile documentation
- Enhanced README with Lovable-specific examples and "What's New" section

### 🧪 Testing

- New test suite: `lovable-scanner.test.ts` (20 tests, 100% coverage for all 6 rules)
- New test suite: `vite-scanner.test.ts` (18 tests, ~78% coverage for all 3 rules)
- Enhanced test suite: `react-security-scanner.test.ts` (17 tests, ~94% coverage)
- Overall test coverage: ~47% → ~70%
- All 88 tests passing

### 🎯 Target Audience

This release is specifically designed for developers using:
- **Lovable.dev** (primary focus)
- Cursor, Windsurf, Replit (also supported)
- Any React + Vite + Supabase stack

### Breaking Changes

None. All changes are additive and backward-compatible.

### Notes

- Lovable profile complements (not replaces) Lovable's built-in scanner
- Auto-detection works seamlessly - just run `ubon scan`
- Dashboard feature deferred to v1.3.0

## 1.1.6 — 2025-09-18

### Fixed
- **Documentation Completeness**: Updated all documentation files to accurately reflect current capabilities
  - Added missing `ubon guide` command to CLI.md documentation  
  - Updated FEATURES.md with contextual guidance and guide command features
  - Added missing Rails security rules (RAILS001-005) to RULES.md documentation
  - Ensured 100% accuracy between implemented features and their documentation

### Notes
- This is a documentation accuracy release ensuring all docs reflect actual codebase capabilities
- No functional changes - all existing features continue to work as expected

## 1.1.5 — 2025-09-18

### Fixed
- **Documentation Packaging**: Corrected npm package to include complete integration guide (GUIDE.md) and updated README
- **GitHub Release**: Fixed v1.1.4 release to point to correct commit with all changes

### Notes
- This is a documentation fix for v1.1.4 - no functional changes
- All v1.1.4 features work correctly, this adds missing documentation files to npm package

## 1.1.4 — 2025-09-18

### Added
- **Smart Contextual Guidance**: Intelligent post-scan suggestions based on results
  - Suggests `--interactive` mode for critical issues
  - Recommends `--focus-critical` for high-severity findings
  - Points to `--apply-fixes` when auto-fixable issues found
  - Guides AI workflow with specific copy-paste instructions
- **`ubon guide` Command**: New CLI command to access integration documentation
  - Shows guide file location and quick command examples
  - Provides essential workflows for developers and AI agents
- **Enhanced Help Text**: Improved CLI descriptions promoting key features
  - Main help mentions guide command and interactive mode
  - Command descriptions highlight AI-friendly options

### Enhanced
- **Integration Guide**: Renamed from `AI_AGENT_GUIDE.md` to `GUIDE.md` for universal appeal
  - Added real JSON/SARIF/CLI output examples
  - Enhanced troubleshooting section with common issues
  - Added framework-specific integration patterns
  - Comprehensive rule catalog with confidence levels
  - Performance optimization guidance for large codebases

### Technical
- Smart guidance skips display in JSON mode and interactive mode
- Guide command intelligently locates documentation file
- All contextual suggestions use consistent lotus branding

### Notes
- This release focuses on user experience improvements
- Makes Ubon much more discoverable and intuitive for new users
- Provides better integration patterns for AI assistants

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
