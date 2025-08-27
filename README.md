# 🪷 Ubon

<p align="center">
  <img src="branding/Ubon.png" alt="Ubon — Peace of mind for vibe‑coded apps" width="100%" />
</p>

> TL;DR
>
> Fed up with “You’re absolutely right!” when debugging vibe‑coded apps with AI?
>
> ```bash
> npm i -g ubon@latest
> npx ubon scan .
> # Or tell your AI to install Ubon and run it
> ```
>
> 🪷 Peace of mind for vibe‑coded apps.

[![npm version](https://badge.fury.io/js/ubon.svg)](https://badge.fury.io/js/ubon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Contents

- What is Ubon?
- At a glance
- The reality of debugging AI-generated code
- Quick Start
- How to Use with AI Assistants
- What does it check?
- CLI
- Highlights in v1.1.0
- Common Workflows
- Baseline/Suppressions
- JSON Output
- SARIF Output
- Programmatic Usage
- Requirements
- FAQ
- Experimental: Next.js Routing/Structure Rules
- Changelog
- Contributing
- License
- Branding
- Release policy

## What is Ubon?

Ubon is a fast static analysis tool for modern, AI‑generated “vibe‑coded” apps. It finds real, shippable issues—secrets, insecure cookies/redirects, accessibility problems, broken links, and config mistakes—and explains how to fix them with file:line context.

Use the colorized triage in the terminal or JSON/SARIF for CI and AI. Profiles cover Next.js/React, Python, and Rails (experimental). See profiles in `docs/PROFILES.md` and the full capability matrix in `docs/FEATURES.md`.

### At a glance

- Security, accessibility, links, and config checks across Next.js/React, Python, Vue, and Rails (experimental)
- Human-friendly triage: grouping, color, context, explanations, confidence scores
- Baselines and inline suppressions for low-noise adoption
- JSON and SARIF outputs for CI and AI; OSV caching for speed
- Safe autofixes and optional PR creation; watch mode and changed-files gates


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
$ ubon check --group-by severity --min-severity medium

🪷 Ubon — Triage
High: 1 error   Medium: 1 warning

HIGH
  ❌ SEC003 Hardcoded OpenAI key (lib/ai.ts:12)
     fix: Move key to OPENAI_API_KEY env var

MEDIUM
  ⚠️ A11Y001 Image without alt attribute (components/Hero.tsx:22)
     fix: Add alt="" or a short descriptive text
```

## About me and Ubon

Hi, I'm Luisfer Romero Calero, an experienced software engineer passionate about building products and being creative. You can find more about me at https://lfrc.me. I created Ubon in six days, obsessed with solving a problem I kept seeing everywhere: the current wave of AI-generated "vibe-coded" apps that, while incredibly quick to build, are frustrating to deploy and use because AI overlooks so many essential details.

The explosion of AI-generated apps through tools like Lovable, Replit, Cursor and Windsurf has democratized software creation. But it’s also created a quiet reliability crisis. Non-technical users prompt AI with "this doesn't work!!!" without knowing what to check, they don’t have the vocabulary to prompt precisely, and AI assistants miss the non‑obvious issues that slip past linters: hardcoded secrets, broken links, accessibility failures, and those subtle security vulnerabilities that only surface in production.

I built Ubon after realizing that instead of fighting this AI-powered wave, we should embrace it and make it better. Think of Ubon as a safety net for the age of AI-generated code, a gentle guardian that catches what traditional tools miss. It works seamlessly with the standard Next.js/React repos that agentic AI tools create by default, as well as Python projects and Vue.js ones.

My hope is that Ubon becomes so essential it gets baked into Cursor, Windsurf, and other AI coding tools, automatically scanning every vibe-coded creation before it hits production. Because when anyone can ship software, everyone needs peace of mind.

_Ubon_ means lotus in Thai, inspired by Ubon Ratchathani province where someone very special to me is from. The lotus represents the clarity and peace of mind this tool brings to debugging.

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
Quick AI pass (JSON):

```bash
ubon check --ai-friendly > ubon.json
```

## How to Use with AI Assistants

### The Magic Workflow

```bash
$ ubon scan
```

Then tell your AI assistant:

"I ran Ubon and got N issues. Please help me fix them, starting with high severity."

### Why This Works

❌ Without Ubon:
- AI guesses what might be wrong
- Focuses on syntax or surface errors
- Misses security and a11y issues
- Long back-and-forth debugging loops

✅ With Ubon:
- Concrete, prioritized findings with file:line
- Explanations and code context
- Smart grouping and severity filters
- Fixes root causes in 1–2 exchanges

### Pro Tips for AI Conversations

```bash
# Share the full output
ubon scan > issues.txt
```
Paste into the chat and ask for prioritized fixes.

```bash
# Focus on high-severity first
ubon scan --max-issues 5 --group-by severity
```

```bash
# Group by file for large projects
ubon scan --group-by file
```

### Real Example

Before Ubon: “My Next.js auth is broken” → 45-minute debugging session.

With Ubon: “Hardcoded JWT in `pages/api/auth.ts:23`, missing `HttpOnly; Secure` on cookies” → fixed in minutes.

## What Does It Check?

See a complete feature and checks matrix in `docs/FEATURES.md`.

Top areas covered:
- Security findings across Next.js/React, Python, and Rails (experimental)
- Accessibility issues that slip past linters
- Link reachability and resource problems
- Dependency advisories via OSV

## CLI

Full reference lives in `docs/CLI.md`. Config format in `docs/CONFIG.md`. Rules glossary in `docs/RULES.md`. See `docs/README.md` for the docs hub and archived notes.

Exit codes respect `--fail-on`. See `docs/CLI.md`.

Commonly used flags (v1.1.0):

- Output UX: `--color auto|always|never`, `--group-by file|rule|severity|category`, `--min-severity`, `--max-issues`
- Context: `--show-context`, `--explain`
- Confidence: `--show-confidence` (or use `--verbose`)
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

## Highlights in v1.1.0

- Colorized, branded output with lotus (🪷); control via `--color auto|always|never`
- Result organization: `--group-by file|rule|severity|category`, `--min-severity`, `--max-issues`
- Deep context: `--show-context` (3–5 lines) and `--explain` (why it matters)
- Inline suppressions: `// ubon-disable-next-line RULEID [reason]` (see `docs/SUPPRESSIONS.md`)
- OSV cache for dependency advisories with `--clear-cache`, `--no-cache`, and `ubon cache` command
- New Next.js security rules (JWT/cookies, redirects, CORS, client env leaks)
- New Next.js rules (security + routing/structure, experimental)
- New CI/Dev tooling: `--watch`, `--base-sha`, `--create-pr`
- VS Code extension (MVP): problems + quick fixes
- Experimental Rails profile

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

# Preview safe autofixes without writing changes
ubon check --fix-dry-run --group-by file

# Apply safe autofixes (A11Y, cookie flags, secret-log redaction)
ubon check --apply-fixes
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

## Example Output (v1.1.1 human view)

```bash
$ ubon check --group-by severity --min-severity medium --show-context --explain --show-confidence

🪷 Ubon — Triage
High: 1 error   Medium: 2 warnings   Suppressed: 1 (hidden)

HIGH
  ❌ SEC003 Hardcoded OpenAI key (lib/ai.ts:12) (confidence: 0.94)
     why it matters: Leaked API keys are abused quickly and can incur cost.
     fix: Move the key to an environment variable (e.g., OPENAI_API_KEY).
     context:
       10 | import fetch from 'node-fetch'
       11 |
       12 | const openaiKey = "sk-********************************" // redacted
          |                     ^ secret-like token detected
       13 | export async function ask(prompt: string) {

MEDIUM
  ⚠️ A11Y001 Image without alt attribute (components/Hero.tsx:22)
     fix: Add alt="" or a descriptive text.
     context:
       21 | <div className="hero">
       22 |   <img src="/banner.png" />
          |        ^ missing alt attribute

  ⚠️ JSNET001 fetch without AbortController signal (lib/net.ts:7)
     fix: Pass { signal } from an AbortController to avoid hanging requests.

Notes
  • Use --show-suppressed to include suppressed results
  • Use --max-issues 5 to focus on the most critical first
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

See `CHANGELOG.md` for release notes (latest: 1.1.2).

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

## How to Use with AI Assistants

### The Magic Workflow

```bash
$ ubon scan
```

Then tell your AI assistant:

"I ran Ubon and got N issues. Please help me fix them, starting with high severity."

### Why This Works

❌ Without Ubon:
- AI guesses what might be wrong
- Focuses on syntax or surface errors
- Misses security and a11y issues
- Long back-and-forth debugging loops

✅ With Ubon:
- Concrete, prioritized findings with file:line
- Explanations and code context
- Smart grouping and severity filters
- Fixes root causes in 1–2 exchanges

### Pro Tips for AI Conversations

```bash
# Share the full output
ubon scan > issues.txt
```
Paste into the chat and ask for prioritized fixes.

```bash
# Focus on high-severity first
ubon scan --max-issues 5 --group-by severity
```

```bash
# Group by file for large projects
ubon scan --group-by file
```

### Real Example

Before Ubon: “My Next.js auth is broken” → 45-minute debugging session.

With Ubon: “Hardcoded JWT in `pages/api/auth.ts:23`, missing `HttpOnly; Secure` on cookies” → fixed in minutes.

## Experimental: Next.js P5 Routing/Structure Rules

These heuristics are conservative and may evolve. Enable/disable explicitly if you want to try them today.

```bash
# Try P5 rules only
ubon check --enable-rule NEXT201,NEXT202,NEXT203,NEXT205,NEXT208,NEXT209,NEXT210

# Disable P5 rules
ubon check --disable-rule NEXT201,NEXT202,NEXT203,NEXT205,NEXT208,NEXT209,NEXT210
```

What they look for:
- NEXT201: missing 404/not-found page (Pages vs App Router aware)
- NEXT202: missing error boundary page
- NEXT203: missing _document.tsx when customizing head/scripts (Pages Router)
- NEXT205: API may return sensitive data without auth
- NEXT208: router.push() to external URL (open-redirect risk)
- NEXT209: API route missing HTTP method validation
 - NEXT210: server→client secret bleed via getServerSideProps/getStaticProps props (experimental)
