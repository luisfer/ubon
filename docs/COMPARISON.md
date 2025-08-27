## Ubon vs ESLint vs npm audit

| Capability | Ubon | ESLint | npm audit |
|---|---|---|---|
| File:line with 3–5 line context | Yes (`--show-context`) | Limited (rules dependent) | No |
| “Why it matters” explanation | Yes (`--explain`) | Sometimes (rule docs) | No |
| Confidence scores | Yes (`--show-confidence`) | No | No |
| Secrets (heuristics + patterns) | Yes | No | No |
| Insecure cookies/redirects/CORS | Yes | No | No |
| Client env leaks (Next.js) | Yes | No | No |
| Accessibility basics | Yes | Via plugins | No |
| Broken links (external) | Yes | No | No |
| Dependency advisories | OSV (optional) | No | Yes |
| Baseline/suppressions | Yes | Deprecated/varies | No |
| Safe autofixes (security/a11y) | Yes (`--apply-fixes`) | Yes (style) | No |
| JSON/SARIF for CI | Yes | Limited | JSON via npm |
| Markdown PR summary | Yes (`--pr-comment`) | No | No |
| Compact table output | Yes (`--format table`) | No | No |

Notes:
- Tools are complementary. ESLint covers style/code conventions; npm audit covers dependency CVEs; Ubon focuses on real‑world security/accessibility/links/config with actionable context.

