### Ubon Roadmap

This document tracks planned improvements for the next minor release.

## Next version: v1.1.0 (proposed)

### Output and UX
- **Colorized, branded output**: Chalk theme with lotus (🪷), toggle via `--color auto|always|never` and `--format human|table|json`.
- **Grouping/deduping**: `--group-by file|rule`, collapse repeated findings, `--min-severity warning|error`, `--max-issues N`.
- **Actionable snippets**: 3–5 lines of code context and a short “why it matters”.

### Auto-fix and repair
- **Expand safe fixes**:
  - Add `alt` attributes and input labels/aria-labels.
  - Add cookie flags: `HttpOnly; Secure; SameSite=Lax`.
  - Remove hardcoded env fallbacks and secret-logging statements.
  - Wrap `fetch` with AbortController timeout and basic retry/backoff.
- **PR generator**: `--apply-fixes --create-pr` to branch, commit, and open a reviewable PR with a summary.
- **Per-rule codemods**: Fixers shipped per `ruleId` so teams can opt in/out.

### Rule coverage (security + Next.js)
- **JWT/cookies**: Detect tokens returned in JSON, weak/inline secrets, missing cookie flags.
- **Next.js App Router**: Client/server boundary leaks, `NEXT_PUBLIC_*` misuse, `dangerouslySetInnerHTML`, open redirects, CORS in `middleware.ts`.
- **Data exfil/logging**: Secrets/PII in logs, `JSON.stringify(req)` dumps, verbose prod errors.
- **Network**: SSRF sinks (`fetch(userInput)`), unbounded axios/fetch, missing `signal`.
- **Config**: Insecure `next.config.js` (e.g., permissive `images.domains`, `eslint.ignoreDuringBuilds`), risky webpack overrides.
- **Backend**: String‑built SQL, `new Function`, shell exec, Prisma `.env` leaks.

### Signal/noise controls
- **Inline suppressions**: `// ubon-disable-next-line RULEID` (optional reason), surfaced in JSON/SARIF.
- **Tuning**: Per‑rule confidence thresholds in config; first‑class ignore globs for fixtures/mocks/stories.
- **Taxonomy**: Add CWE/OWASP tags per rule and include in outputs.

### Performance and scale
- **Caching**: Local OSV cache with TTL; memoize results by file hash for fast re‑runs.
- **Parallelism**: Bounded concurrency and rate‑limited external link checks.
- **Watch mode**: `ubon check --watch --fast` incremental scanning on file changes.

### CI and PR integration
- **Review bot**: Optional GitHub reviewer that posts inline comments for new/changed issues.
- **Gates**: “New issues only” gate using base SHA; budget mode (cap warnings/errors).
- **SARIF polish**: Rich `helpUri` links to rule docs and remediation examples.

### IDE and developer ergonomics
- **VS Code extension**: In‑editor diagnostics and quick‑fixes for autofixable rules.
- **Init recipes**: `ubon init` can generate `.env.example` and a minimal security checklist tailored to the profile.

### Programmatic API and schema
- **Stable JSON schema**: Publish `@ubon/schema` for typed consumers (versioned).
- **Result fingerprints**: Stability across reformatting; document derivation.

### Scanner safety and privacy
- **Default redaction**: Mask secret‑like strings in human output; keep stable fingerprints.
- **Sandboxing**: Never execute user code; mock dynamic imports; document network usage and opt‑outs.

### Explore expansion to Rails?

Rails would be very doable with ubon's current architecture.

  Here's why I think it would work well:

  What's already there ✅

  - Multi-language framework - ubon already handles JS, Python with profiles
  - Pattern-based detection - Ruby syntax is very scannable with regex patterns
  - CVE database integration - Should already include Ruby gems vulnerabilities
  - Environment scanning - Would work for Rails config/ files, database.yml, etc.
  - File structure awareness - Could easily learn Rails conventions

  Rails-specific rules to add 🔨

  High-impact vulnerabilities:
  # SQL injection patterns
  User.where("name = '#{params[:name]}'")  # Should flag
  User.find_by_sql("SELECT * FROM users WHERE id = #{id}")

  # Mass assignment 
  User.create(params[:user])  # Without strong params

  # Command injection
  system("ls #{params[:dir]}")  # Shell injection
  `git log #{branch}`  # Backtick injection

  # Deserialization
  YAML.load(user_input)  # vs YAML.safe_load
  Marshal.load(data)

  # Template injection in ERB
  <%= params[:content].html_safe %>  # XSS risk

  Rails-specific files to scan:
  - Gemfile.lock - Gem vulnerabilities (like requirements.txt)
  - config/database.yml - Database credentials
  - config/secrets.yml - Hardcoded secrets
  - app/controllers/ - Strong params, authentication
  - app/views/ - XSS, template injection

  Implementation approach 🛠️

  Phase 1 (Easy wins):
  - Add --profile rails
  - Ruby syntax patterns for eval, system, YAML.load
  - Gemfile.lock vulnerability scanning (similar to requirements.txt)
  - Config file secret detection

  Phase 2 (Rails-aware):
  - ActiveRecord query pattern analysis
  - Strong parameters validation
  - ERB template scanning
  - Rails security best practices

  Phase 3 (Advanced):
  - Semantic analysis of Rails patterns
  - Route/controller flow analysis
  - Authentication/authorization checks

  The beauty is ubon's pattern-based + profile system would translate perfectly to
  Rails. Most Ruby vulnerabilities follow predictable patterns that regex can catch
  effectively.

  Biggest win: Rails has very established security patterns, so the rules would be
  highly accurate with fewer false positives than general-purpose scanners.

## v1.1.0 milestone priorities
- **P1**: Output/UX polish (color/theme, grouping, context snippets); inline suppressions; OSV caching; cookie/JWT rules.
- **P2**: Expanded autofixes and `--create-pr`; “new issues only” CI gate; watch mode.
- **P3**: VS Code extension (MVP); SARIF help links; schema package draft.
- **P4**: New profile 'Rails'. And include it in the relevant documentation, README, etc. (anywhere where it's mentioned that is for Next/React, Python and Vue)

## Success criteria
- Human output: grouped by file/rule, colorized, with context snippets and < 120 ms added overhead in `--fast` mode on medium repos.
- JSON/SARIF: include CWE/OWASP tags, suppressions, stable fingerprints; validated by sample CI run.
- Autofixes: at least A11Y001/A11Y002, cookie flags, secret‑logging removal proven on sample repos.

## Notes
- Maintain redaction by default in human output; never print full secrets.
- Add docs for reducing false positives and enabling baselines.
