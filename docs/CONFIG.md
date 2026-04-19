# Configuration

Ubon loads configuration from (in order):

1. `ubon.config.json`
2. `ubon.config.js` (default export) — **gated**, see callout below
3. `package.json` under `"ubon": { ... }`

CLI flags always win.

## `ubon.config.js` requires opt-in

Loading `ubon.config.js` executes user-supplied code in the Ubon process,
so v3.0.0 gates it behind an explicit opt-in:

```bash
ubon check --allow-config-js
# or, persistently in CI:
UBON_ALLOW_CONFIG_JS=1 ubon check
```

Without the flag, only `ubon.config.json` and the `package.json` `"ubon"`
field are loaded. This protects users from a `ubon.config.js` planted by a
malicious dependency or commit.

## Options

```jsonc
{
  "minConfidence": 0.8,
  "failOn": "warning",              // none|warning|error
  "enabledRules": ["SEC003"],       // allowlist
  "disabledRules": ["SEC015"],      // blocklist
  "baselinePath": ".ubon.baseline.json",
  "updateBaseline": false,
  "useBaseline": true,
  "changedFiles": ["src/a.ts"],
  "gitChangedSince": "origin/main",
  "profile": "auto",                // auto|lovable|react|next|sveltekit|astro|remix|hono
  "gitHistoryDepth": 20,
  "maxFileSize": 1048576,           // bytes; default 1 MiB (BaseScanner enforces this)
  "skipPatterns": ["**/*.generated.ts"],
  "minSeverity": "low",             // low|medium|high
  "groupBy": "category",            // category|file|rule|severity
  "format": "human"                 // human|table
}
```

Precedence:

1. CLI flags
2. `ubon.config.(json|js)` (the latter only with `--allow-config-js`)
3. `package.json` `"ubon"` field

## `maxFileSize`

Files larger than `maxFileSize` (default **1 MiB**, `1_048_576` bytes) are
skipped. The cap protects against pathological regex backtracking on
minified bundles, source maps, and lockfiles. Bump it explicitly if you
intentionally scan generated code:

```json
{ "maxFileSize": 4194304 }
```

## Example: Lovable app

```json
{
  "profile": "lovable",
  "minConfidence": 0.8,
  "failOn": "error",
  "disabledRules": ["DEV001", "DEV002"],
  "enabledRules": ["LOVABLE*", "VITE*", "TAILWIND001"],
  "useBaseline": true
}
```

Or rely on auto-detection (recommended for fresh projects):

```json
{
  "profile": "auto",
  "minConfidence": 0.85,
  "failOn": "warning"
}
```

## Example: Next.js monorepo package

```json
{
  "profile": "next",
  "minConfidence": 0.8,
  "failOn": "error",
  "skipPatterns": ["**/.next/**", "**/dist/**"],
  "baselinePath": ".ubon.baseline.json"
}
```
