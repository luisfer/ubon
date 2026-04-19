# Ubon CLI Reference

See also: [`docs/RULES.md`](./RULES.md) for the rule glossary,
[`docs/CONFIG.md`](./CONFIG.md) for `ubon.config.json` shape, and
[`docs/ADVANCED.md`](./ADVANCED.md) for profiles, suppressions, baselines,
and output schemas.

> **Profiles in v3** — `auto`, `lovable`, `react`, `next`, `sveltekit`,
> `astro`, `remix`, `hono`. The `python`, `rails`, and `vue` profiles were
> removed in v3.0.0 (see [`MIGRATION-v3.md`](../MIGRATION-v3.md)).

---

## Commands

### `ubon scan`

Full scan including OSV advisories and external link checks.

```text
ubon scan [options]

Options:
  -d, --directory <path>      Directory to scan (default: cwd)
  -p, --port <number>         Dev server port for link checking (default: 3000)
  --skip-build                Skip link checking (static analysis only)
  -v, --verbose               Verbose output
  --fail-on <level>           none|warning|error (default: error)
  --min-confidence <n>        Minimum confidence (0.0-1.0)
  --enable-rule <id...>       Only enable these ruleIds (repeatable)
  --disable-rule <id...>      Disable these ruleIds (repeatable)
  --baseline <path>           Path to baseline file
  --update-baseline           Write current findings to baseline and exit
  --no-baseline               Disable baseline filtering
  --json                      Emit JSON (deterministic; v2.0.0 schema)
  --ndjson                    Emit one JSON-encoded finding per line (streaming)
  --output <path>             Write JSON/NDJSON output to a file
  --sarif <path>              Also write a SARIF 2.1.0 report
  --schema                    Print the JSON Schema for --json output and exit
  --changed-files <paths...>  Only scan these files (repeatable)
  --git-changed-since <ref>   Only scan files changed since a Git ref
  --base-sha <ref>            CI gate: only fail on findings introduced since ref
  --fix-dry-run               Print auto-fix plan (no writes)
  --preview-fixes             Show diff-style preview without applying
  --apply-fixes               Apply available safe auto-fixes
  --create-pr                 After applying fixes, open a PR (uses `gh` if present)
  --profile <name>            auto|lovable|react|next|sveltekit|astro|remix|hono
  --git-history-depth <n>     Scan last N commits for leaked secrets
  --fast                      Skip OSV / link / crawler checks
  --crawl-internal            [deprecated v3] Crawl internal links via puppeteer
  --crawl-start-url <url>     Starting URL for internal crawl
  --crawl-depth <n>           Max crawl depth (default: 2)
  --crawl-timeout <ms>        Per-page timeout (default: 10000)
  --detailed                  Include lower-confidence / noisy findings
  --focus-critical            Only show high-severity findings
  --focus-security            Only show security category
  --focus-new                 Only show findings absent from baseline
  --color <mode>              auto|always|never (default: auto)
  --group-by <mode>           category|file|rule|severity (default: category)
  --format <mode>             human|table (default: human)
  --min-severity <level>      low|medium|high
  --max-issues <n>            Cap human-readable output to N items
  --show-context              Show 3-5 lines of code around findings
  --explain                   Show "why it matters" explanation per finding
  --show-confidence           Show per-finding confidence in human output
  --show-suppressed           Include suppressed findings in output
  --ignore-suppressed         Drop suppressed findings entirely
  --clear-cache               Clear OSV cache before scanning
  --no-cache                  Disable OSV caching for this run
  --no-result-cache           Disable per-file result caching
  --pr-comment                Emit a Markdown summary suitable for PR comments
  --interactive               Walk through findings one-by-one
  --watch                     Re-run on file changes
  --quiet                     Suppress banners and contextual guidance (CI-friendly)
  --allow-config-js           Permit loading ubon.config.js (executes user code)
  --ai-friendly               Preset: --json + --show-context + --explain + --group-by severity + --max-issues 15
```

Examples:

```bash
ubon scan --json
ubon scan --git-changed-since origin/main --fail-on error
ubon scan --update-baseline
ubon scan --sarif ubon.sarif
ubon scan --focus-critical --focus-security
ubon scan --interactive
```

### `ubon check`

Same surface as `scan` but skips network-bound work (OSV, link/crawl).
Use this in pre-commit, watch mode, and tight inner loops.

```bash
ubon check --json --quiet                 # CI-safe, parseable
ubon check --ndjson | jq -c .              # streaming pipeline
ubon check --git-changed-since HEAD~1      # incremental
ubon check --watch --fast                  # editor-side loop
ubon check --preview-fixes                 # dry-run autofixes
ubon check --apply-fixes                   # apply autofixes
ubon check --pr-comment > ubon-review.md   # PR summary
```

Exit codes:

- `0` — OK or `--fail-on=none`
- `1` — `--fail-on` threshold exceeded
- `2` — `--profile` selected a removed profile (python|rails|vue)

### `ubon doctor`

Diagnose the local environment: Node version, optional MCP SDK, git presence,
write permissions, and stale baseline files. Run this first when something
unexpected happens.

```bash
ubon doctor
ubon doctor -d ./apps/web
```

### `ubon mcp`

Start the Ubon Model Context Protocol server over stdio so AI assistants
(Cursor, Claude Desktop, Windsurf, Cline) can call:

- `ubon.scan`
- `ubon.check`
- `ubon.explain`
- `ubon.preview-fixes`
- `ubon.apply-fixes` (defaults to dry-run; pass `apply: true` to write)

```bash
ubon mcp
```

The `@modelcontextprotocol/sdk` package ships as an `optionalDependencies`
entry. If your install skipped optional deps, install it manually:
`npm install -g @modelcontextprotocol/sdk`. See [`docs/MCP.md`](./MCP.md).

### `ubon hooks install [--cursor]`

Install editor hooks. Currently only Cursor is supported.

```bash
ubon hooks install --cursor
ubon hooks install --cursor --force        # overwrite existing files
ubon hooks install --cursor -d ./packages/web
```

This writes `.cursor/hooks.json` plus shell scripts so every file edit and
prompt goes through Ubon.

### `ubon completion <shell>`

Print a shell completion script. Supported shells: `bash`, `zsh`, `fish`.

```bash
ubon completion bash > /usr/local/etc/bash_completion.d/ubon
ubon completion zsh  > "${fpath[1]}/_ubon"
ubon completion fish > ~/.config/fish/completions/ubon.fish
```

### `ubon install-hooks`

Install a git pre-commit hook (requires `pre-commit` from PyPI).

```bash
ubon install-hooks --mode fast --fail-on error
pip install pre-commit && pre-commit install
```

Options:

- `--mode fast|full` (default: `fast`) — `fast` skips network checks
- `--fail-on error|warning` — block commit on errors or also on warnings

### `ubon init`

Analyze the repository and generate `ubon.config.json` with recommended
defaults.

```bash
ubon init --profile auto
```

Options:

- `--profile auto|lovable|react|next|sveltekit|astro|remix|hono` — override auto-detect
- `--interactive` — walk through findings during analysis

### `ubon explain <ruleId>`

Show detailed information about a rule, including severity, fix, impact,
example triggers, and suppression syntax. The "Available rule prefixes"
help message is generated from the live registry, so it stays in sync as
new rules are added.

```bash
ubon explain SEC001     # API key detection
ubon explain AI002      # Prompt-injection sink
ubon explain LOVABLE001 # Supabase RLS validation
```

### `ubon cache`

Manage the on-disk OSV vulnerability cache.

```bash
ubon cache --info
ubon cache --clear
ubon cache --cleanup
```

### `ubon lsp`

Start the Ubon language server. Use it from Cursor, VS Code, Neovim, or any
LSP-aware editor for inline diagnostics, hover help, and quick fixes.

```bash
ubon lsp
```

---

## Baseline workflows

```bash
ubon check --update-baseline                                    # snapshot current findings
ubon check                                                      # apply baseline (default)
ubon check --baseline ./security/.ubon.baseline.json            # custom path
```

Inline suppressions:

```ts
// ubon-disable-next-line SEC018 reason here
const token = "eyJhbGciOi...";

// ubon-disable-file
```

---

## CI examples

GitHub Actions (JSON + SARIF + changed-files gating):

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
      - name: Run ubon
        run: |
          ubon check \
            --json --quiet \
            --fail-on error \
            --sarif ubon.sarif \
            --git-changed-since origin/main
      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ubon.sarif
```

Pre-commit (lefthook):

```yaml
pre-commit:
  parallel: true
  commands:
    ubon:
      run: ubon check --quiet --fast --git-changed-since HEAD --fail-on error
```

---

## JSON output

`--json` emits the v2.0.0 finding schema. Print the JSON Schema with:

```bash
ubon check --schema | jq .
```

Highlights:

- `schemaVersion`, `toolVersion`, `summary` (`total`, `errors`, `warnings`, `info`)
- `issues[]` — each carries `ruleId`, `category`, `severity`, `file`, `line`,
  `range`, `confidence`, `confidenceReason`, `match`, `fingerprint`, `fix`,
  `fixEdits`, `helpUri`
- Output is deterministic: keys sorted alphabetically, `issues` sorted by
  severity → file → line → ruleId. NDJSON output is the same payload, one
  finding per line.
- Secrets in `match` are redacted; `fingerprint` is stable across runs.
