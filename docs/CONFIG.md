## Configuration

Ubon loads configuration from:
- `ubon.config.json`
- `ubon.config.js` (export default {...})
- `package.json` under `"ubon": { ... }`

CLI flags override config values.

### Options

```
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
  "profile": "auto",                // auto|lovable|react|next|vue|python|rails
  "gitHistoryDepth": 20
}
```

Precedence:
1) CLI flags
2) ubon.config.(json|js)
3) package.json: "ubon"

### Example: Lovable App Configuration

For Lovable-generated apps (React + Vite + Supabase):

```json
{
  "profile": "lovable",
  "minConfidence": 0.8,
  "failOn": "error",
  "disabledRules": ["DEV001", "DEV002"],  // Allow TODOs in development
  "enabledRules": ["LOVABLE*", "VITE*", "TAILWIND001"],  // Focus on Lovable-specific rules
  "useBaseline": true
}
```

Or let auto-detection handle it:

```json
{
  "profile": "auto",  // Auto-detects Lovable apps
  "minConfidence": 0.85,
  "failOn": "warning"
}
```

