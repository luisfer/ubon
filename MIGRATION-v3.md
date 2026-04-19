# Upgrading to Ubon v3.0.0

v3 is a single, focused release that modernizes the toolchain, ships
the AI-era rule pack, and adds first-class MCP / Cursor hooks. It is
breaking on purpose — the surface area is smaller, the signal is
higher, and the JSON output schema is now versioned (`2.0.0`).

This page is the short list of things you need to change. The release
notes in [`CHANGELOG.md`](./CHANGELOG.md) cover everything else.

## Hard requirements

- **Node.js 20 or newer.** Ubon v3 drops Node 16 and 18 (both EOL).
  Run `ubon doctor` to verify.
- **npm 10+** for provenance and overrides; older npm still installs
  but you'll see a peer warning.

## Removed

| Removed                              | Replacement                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `ubon guide` command                 | `ubon --help`, README, and `docs/`                         |
| Random "show guide" suggestion       | Gone — the human reporter is fully deterministic now       |
| `chalk` dependency                   | Internal `picocolors` shim (no API change in user output)  |
| `.eslintrc.json` (project's own)     | `eslint.config.js` (flat config, ESLint 9)                 |
| `src/rules/registry.ts` (empty stub) | The real registry was already in `src/rules/index.ts`      |

## Removed profiles and scanners

v3 narrows Ubon's scope to modern JS/TS web stacks. The following
profiles, scanners, and rule families are **gone** in v3.0.0. Selecting
them via `--profile` exits with status `2` and prints the suggested
replacement:

| Removed                                | Why                                          | Use instead                                          |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `--profile python`, `PYSEC*`, `PYNET*` | Python is a different ecosystem with mature, dedicated tooling | [Bandit](https://bandit.readthedocs.io/), [Semgrep](https://semgrep.dev), or [pip-audit](https://pypi.org/project/pip-audit/) |
| `--profile rails`, all `RAILS*` rules  | Same story for Ruby; we never reached parity with Brakeman     | [Brakeman](https://brakemanscanner.org)                                                                                       |
| `--profile vue`, `VUE001`              | Vue/Nuxt patterns differ enough to dilute focus                 | [`eslint-plugin-vue`](https://eslint.vuejs.org) plus your existing Supabase/Pinia audits                                       |
| `.py` auto-detection in `auto`         | Tied to the Python profile that no longer exists                | n/a — `auto` now only flips between `lovable` and the JS baseline                                                              |

Existing `ubon.config.json` files that pin one of these profiles need a
single edit:

```diff
- "profile": "python"
+ "profile": "auto"
```

## Deprecated (will be removed in v3.1)

| Deprecated                              | Use instead                                                 |
| --------------------------------------- | ----------------------------------------------------------- |
| `--crawl-internal` (Puppeteer crawler)  | Use Playwright-based external tools; flag still works under `UBON_ALLOW_REMOTE_CRAWL=1` for now |
| Loading `ubon.config.js` by default     | Pass `--allow-config-js` or set `UBON_ALLOW_CONFIG_JS=1`    |

When a deprecated flag is observed, Ubon prints a one-line warning and
keeps working.

## New behaviour worth knowing

- **JSON output schema is now `2.0.0`.** Sorted keys, sorted results,
  no `undefined` fields. If you parse Ubon JSON in CI, expect a
  byte-stable diff per scan. The schema is published at
  `docs/schema/ubon-finding.schema.json` and reachable via
  `ubon check --schema`.
- **`--ndjson`** is the new agent-friendly format: one finding per line.
- **`--quiet`** suppresses banners, summaries, and contextual
  guidance — keep errors visible. `--json` and `--ndjson` imply quiet.
- **`ubon mcp`** runs Ubon as a Model Context Protocol server. The
  required SDK ships as an `optionalDependency` of `ubon`, so most
  installs pick it up automatically. If your install flags skipped it,
  add `@modelcontextprotocol/sdk` to the same scope as `ubon` (global or
  project-local). Full guide: [`docs/MCP.md`](docs/MCP.md).
- **`ubon hooks install --cursor`** writes `.cursor/hooks.json` and
  shell scripts for `afterFileEdit` and `beforeSubmitPrompt`.
- **`ubon doctor`** reports Node version, optional deps, and config
  health.
- **Crawler SSRF guard:** `--crawl-start-url` is restricted to
  `localhost`-class addresses by default. Override with
  `UBON_ALLOW_REMOTE_CRAWL=1`.
- **`maxFileSize` guard:** files over 1 MiB are skipped by default to
  avoid pathological regex backtracking. Configure via the
  `maxFileSize` config key.

## Programmatic API

`UbonScan` constructor now takes an optional fourth argument:

```ts
new UbonScan(verbose, silent, colorMode, quiet);
```

`quiet` is additive — existing 3-arg call sites keep working.

## Output stability

If you have a baseline file from v2.x:

```bash
# Re-generate it once with v3 to pick up the deterministic ordering
ubon check --baseline .ubon-baseline.json --update-baseline
```

Fingerprints are stable across runs but were re-keyed slightly between
2.x and 3.0 to include the canonical `ruleId` ordering.

## Smallest possible upgrade

```bash
nvm use 20
npm install -g ubon@latest
ubon doctor
ubon check --json --schema       # confirm new schema
ubon check --baseline .ubon-baseline.json --update-baseline
```

If anything regresses, file an issue with the output of `ubon doctor`
and the failing command.
