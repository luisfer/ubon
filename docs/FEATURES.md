## Ubon Features (All Capabilities)

### What Ubon Checks

| Area | Examples | Notes |
|---|---|---|
| Security (JS/TS/Next) | Secrets (OpenAI/Stripe/AWS/GitHub), Supabase URL/keys, eval/innerHTML, React injection, JWT/cookies, open redirects, CORS, client env leaks | SEC001–SEC019, NEXT007–NEXT011, COOKIE001–004, LOG001, JSNET001 |
| Next.js Routing/Structure (experimental) | missing 404/error pages, method validation, external router.push, server→client secret bleed | NEXT201–NEXT210 (opt-in via enable/disable) |
| Security (Python) | exec/eval, subprocess(shell=True), yaml.load, pickle, requests verify=False, DEBUG=True | PYSEC001–PYSEC010, PYNET001 |
| Rails (experimental) | SQLi in where/find_by_sql, system/backticks, YAML.load, html_safe/raw, mass assignment | RAILS001–005 |
| Development (placeholder detection) | TODO/FIXME comments, "Not implemented" stubs, placeholder URLs, mock data, empty returns | DEV001–005 |
| Accessibility | <img> missing alt, inputs without labels, clickable divs without roles | A11Y001, A11Y004–005 |
| Links & Resources | External link reachability with timeouts; optional internal crawling | LINK00x |
| Dependency & Supply Chain | OSV.dev advisories for npm and PyPI | OSV001 |
| Env & Config | .env hygiene, example drift, hardcoded fallbacks | ENV00x |

### Developer Experience

- **Interactive Mode**: `--interactive` for step-by-step issue walkthrough with explanations and fix options
- **Beautiful CLI**: Lotus-inspired severity bands with enhanced visual triage (`🪷` branding throughout)
- **Smart Contextual Guidance**: Post-scan intelligent suggestions based on results analysis (critical issues, fix patterns, next steps)
- **Integration Guide**: `ubon guide` command displays comprehensive developer and AI agent guide location
- Colorized, branded output with lotus (🪷): `--color auto|always|never`
- Result organization: `--group-by file|rule|severity|category`, `--min-severity`, `--max-issues`
- Compact output: `--format table` for skimmable triage
- Deep context and explanations: `--show-context`, `--explain`
- Confidence scores: `--show-confidence` (or `--verbose`)
- Inline suppressions with reasons: `// ubon-disable-next-line RULEID [reason]`
- Baselines: `--update-baseline`, `--baseline`, `--no-baseline`
- Fast loops: `--watch --fast`, `--git-changed-since`, `--changed-files`
- Safe autofixes: A11Y (alts/roles), cookie flags, secret-log redaction, env fallback cleanup, fetch AbortController signal
- OSV caching with TTL: `--clear-cache`, `--no-cache`, `ubon cache --info|--clear|--cleanup`
- Result cache (per-file): speeds up repeat scans; disable with `--no-result-cache`
- CI gates: `--fail-on`, `--base-sha`, SARIF output
- Create PR workflow: `--create-pr` after `--apply-fixes`

### Profiles

- auto (detects), react/next, vue, python, rails (experimental)

### Outputs and Integration

- Human triage output with grouping and color
- JSON output for AI/automation (stable fields: ruleId, category, severity, confidence, range, fix, helpUri)
- SARIF 2.1.0 for GitHub code scanning

### Next.js Routing/Structure (experimental)

- Missing 404/not-found and error boundary pages (router-aware)
- Missing `_document.tsx` when customizing head/scripts (Pages Router)
- API route method validation and unauthenticated sensitive responses
- `router.push()` to external URL risk
- Server→Client secret bleed in SSR props
  - Rule IDs: NEXT201–NEXT210 (opt-in via enable/disable)

See also: `docs/CLI.md` for full command reference, `docs/RULES.md` for rule glossary, `docs/PROFILES.md` for profiles.


