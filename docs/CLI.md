## Ubon CLI Reference

### Commands

#### ubon scan

Run full scan. Static analysis plus external link checks.

```
ubon scan [options]

Options:
  -d, --directory <path>      Directory to scan (default: current)
  -p, --port <number>         Development server port (for future internal crawling)
  --skip-build                Skip link checking (static analysis only)
  -v, --verbose               Enable verbose output
  --fail-on <level>           none|warning|error (default: error)
  --min-confidence <n>        Minimum confidence threshold (0.0-1.0)
  --enable-rule <id...>       Only enable these ruleIds (repeatable)
  --disable-rule <id...>      Disable these ruleIds (repeatable)
  --baseline <path>           Path to baseline file
  --update-baseline           Update baseline with current findings and exit
  --no-baseline               Do not apply baseline filtering
  --json                      Output results as JSON
  --output <path>             Write JSON output to file
  --sarif <path>              Write SARIF 2.1.0 report to path
  --changed-files <...>       Only scan these files (relative paths)
  --git-changed-since <ref>   Only scan files changed since Git ref
  --fix-dry-run               Print auto-fix plan (no writes)
  --apply-fixes               Apply available safe auto-fixes
  --profile <name>            auto|react|next|python (default: auto)
  --git-history-depth <n>     Scan last N commits for leaked secrets
  --fast                      Skip OSV and link/crawler checks for speed
  --crawl-internal            Crawl internal links with a headless browser
  --crawl-start-url <url>     Starting URL for internal crawl
  --crawl-depth <n>           Max crawl depth (default: 2)
  --crawl-timeout <ms>        Per-page timeout in ms (default: 10000)
  --detailed                  Show all findings including lower-confidence/noisy ones
  --focus-critical            Only show critical (high severity) issues
  --focus-security            Only show security issues (hide a11y/links/etc)
  --focus-new                 Only show issues not in baseline
  --color <mode>              Colorize output: auto|always|never (default: auto)
  --group-by <mode>           Group results: category|file|rule|severity (default: category)
  --min-severity <level>      Minimum severity to include: low|medium|high
  --max-issues <n>            Limit output to N most important issues
  --show-context              Show code context around findings (3–5 lines)
  --explain                   Show "why it matters" explanations
  --show-suppressed           Include suppressed results in output
  --ignore-suppressed         Completely ignore suppressed results
  --clear-cache               Clear OSV cache before scanning
  --no-cache                  Disable OSV caching for this run
```

Examples:

```
# Basic scan with JSON output
ubon scan --json

# Only scan files changed since main
ubon scan --git-changed-since origin/main

# Update baseline and exit
ubon scan --update-baseline

# SARIF report for GitHub code scanning
ubon scan --sarif ubon.sarif

# Show only critical security issues (progressive disclosure)
ubon scan --focus-critical --focus-security

# Show everything, including lower-confidence
ubon scan --detailed
```

#### ubon check

Fast static analysis only.

```
ubon check [options]

Options:
  -d, --directory <path>      Directory to scan (default: current)
  -v, --verbose               Enable verbose output
  --fail-on <level>           none|warning|error (default: error)
  --min-confidence <n>        Minimum confidence threshold (0.0-1.0)
  --enable-rule <id...>       Only enable these ruleIds (repeatable)
  --disable-rule <id...>      Disable these ruleIds (repeatable)
  --baseline <path>           Path to baseline file
  --update-baseline           Update baseline with current findings and exit
  --no-baseline               Do not apply baseline filtering
  --json                      Output results as JSON
  --output <path>             Write JSON output to file
  --sarif <path>              Write SARIF 2.1.0 report to path
  --changed-files <...>       Only scan these files (relative paths)
  --git-changed-since <ref>   Only scan files changed since Git ref
  --fix-dry-run               Print auto-fix plan (no writes)
  --apply-fixes               Apply available safe auto-fixes
  --profile <name>            auto|react|next|python (default: auto)
  --git-history-depth <n>     Scan last N commits for leaked secrets
  --fast                      Skip OSV and link/crawler checks for speed
  --crawl-internal            Crawl internal links with a headless browser
  --crawl-start-url <url>     Starting URL for internal crawl
  --crawl-depth <n>           Max crawl depth (default: 2)
  --crawl-timeout <ms>        Per-page timeout in ms (default: 10000)
  --color <mode>              Colorize output: auto|always|never (default: auto)
  --group-by <mode>           Group results: category|file|rule|severity (default: category)
  --min-severity <level>      Minimum severity to include: low|medium|high
  --max-issues <n>            Limit output to N most important issues
  --show-context              Show code context around findings (3–5 lines)
  --explain                   Show "why it matters" explanations
  --show-suppressed           Include suppressed results in output
  --ignore-suppressed         Completely ignore suppressed results
  --clear-cache               Clear OSV cache before scanning
  --no-cache                  Disable OSV caching for this run
```

Exit codes:
- 0: OK or gated by --fail-on=none
- 1: Threshold exceeded per --fail-on

JSON schema highlights:
- schemaVersion, toolVersion
- ruleId, category, severity, match, range, fingerprint, fix, fixEdits, helpUri
- secrets are redacted in match; fingerprints remain stable

### Baseline workflows

```
# Create or refresh baseline of current findings
ubon check --update-baseline

# Apply baseline on subsequent runs (default)
ubon check

# Use a custom baseline path
ubon check --baseline ./security/.ubon.baseline.json

# Inline suppressions (per-file)
// ubon-disable-next-line SEC018 reason here
const token = "eyJhbGciOi...";
```

### CI examples

GitHub Actions (JSON log + SARIF upload + changed-files gating):

```yaml
name: ubon
on:
  pull_request:
    branches: [ main ]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm i -g ubon
      - name: Compute changed files
        id: diff
        run: |
          echo "files<<EOF" >> $GITHUB_OUTPUT
          git fetch origin main --depth=1
          git diff --name-only origin/main...HEAD >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      - name: Run ubon (JSON)
        run: |
          ubon check --json --fail-on error --sarif ubon.sarif --git-changed-since origin/main || echo "non-zero"
      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ubon.sarif
### Cache management

```
# Show cache directory
ubon cache --info

# Clear cached OSV advisories
ubon cache --clear

# Remove expired entries
ubon cache --cleanup
```
```

### install-hooks

Install a git pre-commit hook that runs Ubon before each commit. Requires `pre-commit` (Python) installed.

```
ubon install-hooks --mode fast --fail-on error

# If pre-commit is not installed, install and enable hooks:
pip install pre-commit && pre-commit install
```

Options:
- `--mode fast|full` (default: fast) – fast skips network checks
- `--fail-on error|warning` – block commit on errors or warnings

### init

Analyze the repository and generate `ubon.config.json` with recommended defaults.

```
ubon init --profile auto
```

Options:
- `--profile auto|react|next|python|vue` – override auto-detection
- `--interactive` – reserved for future interactive prompts

Next.js monorepo example (profile + baseline):

```
ubon check --directory apps/web --profile next --baseline ./apps/web/.ubon.baseline.json
```

Python repo example (secrets in history):

```
ubon check --profile python --git-history-depth 50 --json
```


