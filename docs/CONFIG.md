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
  "profile": "auto",                // auto|react|next|python
  "gitHistoryDepth": 20
}
```

Precedence:
1) CLI flags
2) ubon.config.(json|js)
3) package.json: "ubon"


