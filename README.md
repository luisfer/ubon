# 🪷 Ubon

<p align="center">
  <img src="branding/Ubon.png" alt="Ubon — Peace of mind for vibe‑coded apps" width="100%" />
</p>

Security scanner for React/Next.js, Vue.js, and Python projects.

[![npm version](https://badge.fury.io/js/ubon.svg)](https://badge.fury.io/js/ubon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is Ubon?

Ubon performs static checks that complement linters:

- Broken links and missing resources
- Security risks and exposed secrets
- Accessibility issues
- Common React/Next.js anti-patterns

See profiles and differences in `docs/PROFILES.md`.

### Highlights in v1.1.0 (in progress)

- Colorized, branded output with lotus (🪷); control via `--color auto|always|never`
- Result organization: `--group-by file|rule|severity|category`, `--min-severity`, `--max-issues`
- Deep context: `--show-context` (3–5 lines) and `--explain` (why it matters)
- Inline suppressions: `// ubon-disable-next-line RULEID [reason]` (see `docs/SUPPRESSIONS.md`)
- OSV cache for dependency advisories with `--clear-cache`, `--no-cache`, and `ubon cache` command
- New Next.js security rules (JWT/cookies, redirects, CORS, client env leaks)

## The Reality of Debugging AI-Generated Code

### Without Ubon

> **User**: "The payment button doesn't work"
>
> **AI**: "You're absolutely right! Let me fix that for you..."
>
> _regenerates the component_
>
> **User**: "Still broken"
>
> **AI**: "I apologize! Let me try a different approach..."
>
> _adds more event handlers_
>
> **User**: "Nothing happens when I click"
>
> **AI**: "I see the issue now! Let me update the onClick handler..."
>
> _rewrites the same broken logic_
>
> _[3 hours later...]_
>
> **User**: "PLEASE JUST MAKE IT WORK"
>
> **AI**: "I understand your frustration! Let me completely refactor..."

### With Ubon

```bash
$ ubon check

❌ Stripe key hardcoded in components/Payment.tsx:12
   → Your 'pk_live_...' key is exposed in client code
💡 Use NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY environment variable

❌ Button div has onClick but no keyboard handlers
   → components/Payment.tsx:45
💡 Use <button> element or add onKeyDown for accessibility

✓ Fixed in 30 seconds
```

## About me and Ubon

Hi, I'm Luisfer Romero Calero, an experienced software engineer passionate about building products and being creative. You can find more about me at https://lfrc.me. I created Ubon in six days, obsessed with solving a problem I kept seeing everywhere: the current wave of AI-generated "vibe-coded" apps that, while incredibly quick to build, are frustrating to deploy and use because AI overlooks so many essential details.

The explosion of AI-generated apps through tools like Lovable, Replit, and Cursor has democratized software creation—but it's also created a hidden crisis. Non-technical users prompt AI with "this doesn't work" without knowing what to check, and AI assistants miss the non-obvious issues that slip past linters: hardcoded secrets, broken links, accessibility failures, and those subtle security vulnerabilities that only surface in production.

I built Ubon after realizing that instead of fighting this AI-powered wave, we should embrace it and make it better. Think of Ubon as a safety net for the age of AI-generated code, a gentle guardian that catches what traditional tools miss. It works seamlessly with the standard Next.js/React repos that agentic AI tools create by default, as well as Python projects and Vue.js ones.

My hope is that Ubon becomes so essential it gets baked into Cursor, Windsurf, and other AI coding tools, automatically scanning every vibe-coded creation before it hits production. Because when anyone can ship software, everyone needs peace of mind.

'Ubon' means lotus in Thai, inspired by Ubon Ratchathani province where someone very special to me is from. The lotus represents the clarity and peace of mind this tool brings to debugging.

## Quick Start

### Installation

```bash
npm install -g ubon
```

### Basic Usage

```bash
# Quick static analysis
ubon check

# Full scan with link checking (requires dev server)
ubon scan --port 3000

# Scan specific directory
ubon scan --directory ./my-app

# JSON output for CI/CD and AI agents
ubon check --json
```

### Verify Installation

```bash
ubon --version
ubon check --help
```

### TL;DR

```bash
npm i -g ubon
ubon check --json
ubon scan --sarif ubon.sarif --git-changed-since origin/main
# Human-friendly triage with color and grouping
ubon check --color auto --group-by severity --min-severity medium --max-issues 10
```

## What Does It Check?

### Security
- **Hardcoded secrets**: Supabase keys, OpenAI, Stripe, AWS, GitHub tokens
- **Code execution risks**: `eval()`, `exec()`, `dangerouslySetInnerHTML`
- **Environment files**: Exposed .env, missing .gitignore entries
- **Database credentials**: Connection strings, hardcoded passwords
- **Dependency vulnerabilities**: OSV.dev scanning for npm/PyPI
- **Python-specific**: `subprocess(shell=True)`, `pickle.loads()`, debug mode
- **Git history scanning**: Optional secret detection in commit history

### Links & Resources
- External links (HTTP/S) reachability with timeouts
- Info: internal link crawling available via Puppeteer (opt-in)
  - Enable with `--crawl-internal` (see flags below). Use `--crawl-start-url`, `--crawl-depth`, `--crawl-timeout`.

### Accessibility
- Images without alt text
- Inputs without labels
- Non-semantic interactive elements
- Missing ARIA attributes

## CLI

Full reference lives in `docs/CLI.md`. Config format in `docs/CONFIG.md`. Rules glossary in `docs/RULES.md`.

Exit codes respect `--fail-on`. See `docs/CLI.md`.

Commonly used flags (v1.1.0):

- Output UX: `--color auto|always|never`, `--group-by file|rule|severity|category`, `--min-severity`, `--max-issues`
- Context: `--show-context`, `--explain`
- Suppressions: `--show-suppressed`, `--ignore-suppressed` (inline: see `docs/SUPPRESSIONS.md`)
- OSV cache: `--clear-cache`, `--no-cache`, and `ubon cache --info|--clear|--cleanup`

### `ubon scan` (see full reference in `docs/CLI.md`)

```bash
# Full scan (static + external links)
ubon scan --directory ./my-app

# JSON + SARIF outputs for CI
ubon scan --json --output scan.json --sarif scan.sarif
```

### `ubon check` (see full reference in `docs/CLI.md`)

```bash
# Quick static analysis
ubon check --directory ./my-app

# Only changed files since main
ubon check --git-changed-since origin/main

# Python profile
ubon check --profile python --directory ./python-app

# Generate project config
ubon init

# Install pre-commit hooks (fast mode)
ubon install-hooks --mode fast --fail-on error
```

## Configuration File

Configure defaults via one of (see `docs/CONFIG.md`):

- `ubon.config.json`
- `ubon.config.js` (export default {...})
- `package.json` under `"ubon": { ... }`

Example:

```json
{
  "profile": "next",
  "minConfidence": 0.8,
  "failOn": "error",
  "enabledRules": ["SEC003", "A11Y001"],
  "disabledRules": ["SEC018"],
  "baselinePath": ".ubon.baseline.json"
}
```

CLI flags override config values.

## Common Workflows

### 🚀 CI/CD Integration
```bash
# GitHub Actions - fail build on security errors
ubon check --sarif security-results.sarif --fail-on error

# Only scan changed files for faster CI
ubon check --git-changed-since origin/main
```

### 📊 Team Onboarding
```bash
# Suppress existing issues, focus on new code
ubon check --update-baseline

# Fast development mode (skips slow checks)
ubon check --fast
```

### 🔍 Incremental Scanning
```bash
# Only scan specific files
ubon check --changed-files src/a.ts src/b.tsx

# Scan files changed since last commit
ubon check --git-changed-since HEAD~1
```

## SARIF Output

```bash
ubon check --sarif ubon.sarif
```

GitHub Actions upload:

```yaml
- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: ubon.sarif
```

## Baseline/Suppressions (see more in `docs/CLI.md`)

```bash
# Create or update baseline
ubon check --update-baseline

# Apply baseline automatically on subsequent runs
ubon check

# Custom baseline path
ubon check --baseline ./security/.ubon.baseline.json

# Inline suppressions (per-file scan)
# Suppress the next line for a rule, optional reason
// ubon-disable-next-line SEC016 Safe in this demo
eval('console.log(1)')

# Show/hide suppressed results in output
ubon check --show-suppressed
ubon check --ignore-suppressed
```

Baseline file:

```json
{
  "generatedAt": "2025-01-01T12:00:00.000Z",
  "fingerprints": ["abcd1234ef567890", "deadbeefcafe4444"]
}
```

## Example Output

```bash
🔍 Starting Ubon
ℹ Running Security Scanner...
✓ Security Scanner completed (3 issues found)
ℹ Running Accessibility Scanner...
✓ Accessibility Scanner completed (2 issues found)

──────────────────────────────────────────────────
🔍 Found 5 issues:

🔒 SECURITY:
  ❌ Supabase anon key hardcoded (JWT token pattern) (lib/supabase.ts:7)
      💡 Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable
  ❌ .env file ".env" may not be in .gitignore
      💡 Add .env files to .gitignore to prevent accidental commits
  ⚠️ Supabase URL hardcoded (should use env var) (lib/supabase.ts:4)
      💡 Use NEXT_PUBLIC_SUPABASE_URL environment variable

♿ ACCESSIBILITY:
  ⚠️ Image without alt attribute (components/hero.jsx:22)
      💡 Add descriptive alt attribute to images
  ⚠️ Div with onClick (components/button.tsx:14)
      💡 Use button element or add keyboard event handlers

📊 Summary: 1 errors, 4 warnings
❌ Critical issues found that should be fixed immediately
```

## JSON Schema Notes

Each issue includes:

- `ruleId`: Stable identifier (e.g., `SEC003`, `A11Y001`).
- `confidence`: Heuristic (0.0–1.0) used for automated triage.
- `range` and optional `fixEdits`: machine-actionable context for auto-fixes.

Secrets redaction:

- Sensitive matches (e.g., keys beginning with `sk-`, long JWT-like `eyJ...`) are masked in JSON and SARIF output. Fingerprints remain stable for baselines.

```json
{
  "type": "error",
  "category": "security",
  "message": "Supabase anon key hardcoded (JWT token pattern)",
  "file": "lib/supabase.ts",
  "line": 7,
  "severity": "high",
  "ruleId": "SEC003",
  "confidence": 0.95,
  "fix": "Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable"
}
```

## Programmatic Usage

```typescript
import { UbonScan } from 'ubon';

const scanner = new UbonScan(true);

const results = await scanner.diagnose({
  directory: './my-app',
  port: 3000,
  skipBuild: false
});

scanner.printResults(results);
```

## Limitations

- Heuristic rules may produce false positives. Tune with `--enable-rule/--disable-rule`, `--min-confidence`, and baseline.
- Network-dependent checks (external links, OSV) require connectivity and use timeouts to avoid flakiness.
- No telemetry. Network calls are limited to OSV queries and external HEAD requests for link checks.

## Changelog

See `CHANGELOG.md` for release notes (latest: 1.0.4).

## Requirements

- **Node.js:** 16.0.0 or higher
- **Python:** 3.x+ (for Python project scanning)
- **Git:** Required for `--git-changed-since` features

## FAQ

**Q: Does this replace ESLint/Prettier?**
A: No, Ubon complements them. Use ESLint for code style, Ubon for security/accessibility.

**Q: How do I reduce false positives?**  
A: Use `--min-confidence 0.9`, create a baseline with `--update-baseline`, or disable noisy rules.

**Q: Can I scan only changed files?**
A: Yes, use `--git-changed-since origin/main` or `--changed-files` for faster CI scans.

## Contributing

- Issues: https://github.com/luisfer/ubon/issues
- Add scanners in `src/scanners/` implementing `Scanner`
- Include tests and docs updates

## License

MIT — see `LICENSE`.

## Branding

README banner: `branding/Ubon.png`

Photo credit: [Fallsonata on Unsplash](https://unsplash.com/es/@fallsonata)

Design notes:
- Primary accent color: `#c99cb3`
- Typography in banner: Martini Thai Neue Slab

## Release policy

Ubon follows Semantic Versioning. Patch and minor releases are incremental and non-disruptive. Breaking changes only land in a new major version and include upgrade notes. See `docs/RELEASE-POLICY.md`.