# Advanced Usage

This page collects the topics that don't belong in the headline README:
suppressions, profile internals, baselines, output formats, and the v3
release policy.

It supersedes the older `SUPPRESSIONS.md`, `RELEASE-POLICY.md`, and
`PROFILES.md`.

---

## Profiles

Ubon picks a scanner bundle based on `--profile`. In v3, profiles are a
**rule-bundle registry** (`src/core/profiles.ts`) — adding one is a config
change, not a new scanner class.

All profiles below run the **JS baseline** (Security, AST, Accessibility,
Development, Vibe, AI, Framework, Env, IaC) plus OSV when `--fast` is off.
Specialised profiles add scanners on top of the baseline.

| Profile     | When to use                                   | Extra scanners (in addition to JS baseline)        |
| ----------- | --------------------------------------------- | -------------------------------------------------- |
| `auto`      | default; auto-detects Lovable, falls back to JS baseline | none (or Lovable bundle when detected)  |
| `next`      | Next.js 13/14/15 (App or Pages router)        | none (baseline already covers NEXT*/EDGE* rules)   |
| `react`     | React + Vite or CRA                           | ReactSecurity                                      |
| `lovable`   | Lovable apps (Vite + Supabase + React + TW)   | LovableSupabase, Vite, ReactSecurity               |
| `sveltekit` | SvelteKit projects                            | none (Framework scanner runs SVELTE* rules)        |
| `astro`     | Astro projects                                | none (Framework scanner runs ASTRO* rules)         |
| `remix`     | Remix / React Router v7                       | none (Framework scanner runs REMIX* rules)        |
| `hono`      | Hono / Bun.serve / Elysia                     | none (Framework scanner runs HONO* rules)          |

`auto` flips to `lovable` when it sees `vite.config.*`,
`@supabase/supabase-js` in `package.json`, React, and Tailwind. Otherwise
it runs the JS baseline against the project — running Ubon in a
non-JavaScript repo simply finds nothing.

> **Removed in v3.0.0** — `python`, `rails`, `vue`. Selecting them exits
> with code 2 and points at [`MIGRATION-v3.md`](../MIGRATION-v3.md).
> Use Bandit (Python), Brakeman (Rails), or eslint-plugin-vue (Vue).

---

## Inline suppressions

Silence a specific rule on the next line:

```ts
// ubon-disable-next-line SEC016 demo only
eval('safe-demo');

/* ubon-disable-next-line VIBE001 stub during migration */
import { TODO } from 'not-a-real-package';
```

Suppress an entire file:

```ts
// ubon-disable-file
```

CLI controls:

- `--show-suppressed` — keep suppressed findings visible (marked
  `[SUPPRESSED]`). Useful for triage.
- `--ignore-suppressed` — drop suppressed findings entirely; they no
  longer count towards totals.

Best practice: prefer fixing > suppressing, always include a one-line
reason, and avoid blanket suppressions on security rules.

---

## Baselines

Baselines let you accept the current backlog and only fail on **new**
findings.

```bash
ubon check --baseline .ubon-baseline.json --update-baseline
ubon check --baseline .ubon-baseline.json --focus-new --fail-on error
```

`--focus-new` filters output to issues not present in the baseline;
fingerprints are stable across runs (deterministic JSON ordering, see
below).

---

## Output formats

| Flag              | Output                                                   |
| ----------------- | -------------------------------------------------------- |
| (none)            | Human-readable terminal output, grouped by category      |
| `--json`          | Single JSON object (`schemaVersion: 2.0.0`)              |
| `--ndjson`        | One JSON-encoded finding per line (streaming-friendly)   |
| `--sarif <path>`  | SARIF 2.1.0, GitHub Code Scanning compatible             |
| `--pr-comment`    | Markdown digest, paste into a PR comment                 |
| `--format table`  | Compact ASCII table (still human mode)                   |
| `--schema`        | Print the JSON Schema for `--json` output and exit       |

JSON and NDJSON outputs are **byte-for-byte deterministic** across runs:
keys are sorted, results are ordered by severity → file → line → ruleId,
and undefined fields are stripped. This is what makes `--baseline` and
CI diffing work reliably.

---

## Config file

By default, Ubon loads `ubon.config.json` (or `.ubonrc.json`). To allow
the JS variant — which executes arbitrary code — pass `--allow-config-js`
or set `UBON_ALLOW_CONFIG_JS=1`. Avoid the JS variant when scanning
untrusted repos in CI.

```jsonc
{
  "exclude": ["legacy/**", "vendor/**"],
  "minConfidence": 0.85,
  "disableRules": ["VIBE003"],
  "maxFileSize": 2097152,
  "profile": "next"
}
```

---

## v3 release policy

Ubon follows SemVer with one caveat: **v3.0.0 is a breaking release**.
After 3.0, the rules below apply.

- **Patch / minor**: backward-compatible. New rules default to warning
  or are opt-in. Defaults stay quiet.
- **Major**: breaking changes only here, with a migration guide
  ([MIGRATION-v3.md](../MIGRATION-v3.md)) and at least one minor cycle
  of deprecation warnings.
- **CLI**: no flag removals or renames in patch / minor; deprecate
  first, remove in the next major.
- **JSON / SARIF schema**: stable within a major. Additions are
  backward-compatible. The current schema is published at
  `docs/schema/ubon-finding.schema.json` and exposed via
  `ubon check --schema`.
- **Secrets**: the centralized `redact()` utility runs on every
  `match` in JSON, SARIF, and Markdown output. Fingerprints are stable
  across runs.

If you hit a regression after upgrading, please file an issue with the
version, command, and `ubon doctor` output.
