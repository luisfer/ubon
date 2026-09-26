# Upgrade from Ubon 3

Ubon 4 is a rewrite, so commands, options, rule IDs, the configuration file, and suppression comments all changed. [history.md](history.md) explains why. This page lists what to change.

## Steps

1. Update the package: `npm install --save-dev ubon@4`. Projects that run Ubon with `npx` need no install.
2. Run `npx ubon init` in the repository. It prints a plan and writes nothing. It removes the files that `ubon agent install` wrote in 3.2 (see the next section) and sets up the agents it finds.
3. Run `npx ubon init --yes` to apply the plan.
4. Move the settings you need from `ubon.config.json` to `ubon.json` ([table below](#configuration)), then delete `ubon.config.json`.
5. Replace `ubon-disable-next-line` and `ubon-disable-file` comments with `ubon-ignore` comments ([below](#suppression-comments)). Ubon 4 ignores the old comments.
6. Run `npx ubon check --all` once to see where the project stands.

`ubon check` looks only at what changed since the base branch, so most projects need no baseline. If you run `ubon check --all` in CI, run `ubon baseline` once and commit `.ubon/baseline.json`.

## Files that `ubon init` replaces

Ubon 3.2 wrote these files from fixed templates. `ubon init` finds them by their exact names and text; files you changed by hand are left alone and listed in its notes.

| Ubon 3 file | What `ubon init` does |
| --- | --- |
| Entries in `.cursor/hooks.json` that run `.cursor/hooks/ubon-*.sh` | Removes them and keeps your other hooks. `ubon init --cursor` adds the Ubon 4 hooks. |
| The eight `.cursor/hooks/ubon-*.sh` scripts | Removes them. |
| `.cursor/rules/ubon.mdc` | Removes it. The Ubon skill in `.agents/skills/ubon/` replaces it. |
| The "Agent guidance" section in `AGENTS.md` | Removes it. The block between `ubon:begin` and `ubon:end` replaces it. |
| The "Claude Code guidance" section in `CLAUDE.md` | Removes it. When nothing else is left, the file becomes `@AGENTS.md`, so Claude Code reads the same instructions as other agents. |
| `.pre-commit-config.yaml` with the `ubon-security-check` hook | Replaces the file with the Ubon 4 hook when it holds only that hook. Otherwise it prints a note; edit the file as shown in [ci.md](ci.md). |
| `.github/workflows/ubon.yml` that runs `ubon verify` | Replaces it with the Ubon 4 workflow. |
| `.ubon/` in `.gitignore` | Changes it to `.ubon/*` and `!.ubon/baseline.json`, so the baseline can be committed. |
| `.ubon/results-cache.json` | Removes it. Ubon 4 writes no cache into the project. |
| `ubon.config.json` | Keeps it and prints a note. |

`ubon init --remove` removes the same Ubon 3 files, along with everything Ubon 4 added.

## Commands

| Ubon 3 | Ubon 4 |
| --- | --- |
| `ubon check`, `ubon scan` | `ubon check --all` checks the whole repository. `ubon check` checks the changes. |
| `ubon changed`, `ubon verify` | `ubon check` |
| `ubon review --since <ref>` | `ubon check --base <ref>` |
| `ubon agent install`, `ubon hooks install`, `ubon install-hooks` | `ubon init` |
| `ubon rules list --json` | `ubon rules --json` |
| `ubon explain SEC030` | `ubon explain web/ssrf` (rule IDs changed; `ubon rules` lists them) |
| `ubon mcp` | `ubon mcp`, with the tools `check`, `explain`, `map`, and `vet` ([mcp.md](mcp.md)) |
| `ubon doctor` | `ubon doctor` |
| `ubon lsp`, `ubon completion`, `ubon guide`, `ubon cache` | Removed |

When you run a Ubon 3 command or option, Ubon 4 exits with code 2 and names the replacement.

## Options

| Ubon 3 | Ubon 4 |
| --- | --- |
| `--json` | `--format json` |
| `--sarif <file>` | `--output <file>.sarif` (the format follows the extension) |
| `--fail-on <level>` | Removed. The exit code is 1 when there is a `block` finding. Set rule levels in `ubon.json`. |
| `--fast` | Removed. Checks are local unless you pass `--online`. |
| `--profile`, `--preset`, `--mode` | Removed. Frameworks are detected per file. |
| `--changed-files <paths>` | `ubon check <paths...>` |
| `--git-changed-since <ref>`, `--since <ref>`, `--base-sha <ref>` | `--base <ref>` |
| `-d`, `--directory <path>` | Run Ubon in that directory, or pass paths. |
| `--min-confidence`, `--min-severity`, `--severity` | Removed. Every rule reports `block` or `warn`. |
| `--enable-rule <id>` | `--rule <id>` for one run |
| `--disable-rule <id>` | `"rules": { "<id>": "off" }` in `ubon.json` |
| `--baseline`, `--update-baseline` | `ubon baseline` writes `.ubon/baseline.json`; `ubon check --all` reads it. |
| `--no-cache`, `--no-result-cache`, `--clear-cache` | Removed. Ubon 4 keeps no cache. |
| `--interactive`, `--watch`, `--apply-fixes`, `--preview-fixes`, `--create-pr` | Removed. The agent hooks check each edit, and the agent makes the fixes. |

## Configuration

Ubon 4 reads `ubon.json` only. It never runs a JavaScript config file and never reads a `"ubon"` key in `package.json`. [config.md](config.md) lists every key.

| `ubon.config.json` (Ubon 3) | `ubon.json` (Ubon 4) |
| --- | --- |
| `disabledRules: ["SEC015"]` | `"rules": { "<new id>": "off" }` |
| `enabledRules` | No equivalent. Every rule runs unless it is `off`. |
| `failOn`, `minConfidence`, `minSeverity` | `"rules"` levels: `block`, `warn`, or `off`, per rule or per pack (`"web/*": "warn"`). |
| `exclude`, `skipPatterns` | `"ignore": ["legacy/**"]` |
| `maxFileSize` | `"maxFileSize"` (same meaning) |
| `baselinePath`, `useBaseline`, `updateBaseline` | `ubon baseline`; the path is always `.ubon/baseline.json`. |
| `changedFiles`, `gitChangedSince` | Command-line only: `ubon check <paths...>` and `--base <ref>`. |
| `profile`, `groupBy`, `format`, `gitHistoryDepth` | Removed. |

## Suppression comments

Ubon 3 accepted `// ubon-disable-next-line SEC016 demo only` and `// ubon-disable-file`. Ubon 4 accepts one form, on the line above the finding or at the end of the line:

```ts
// ubon-ignore web/ssrf: user confirmed: the URL comes from our own config table, not from the request
const res = await fetch(target);
```

The comment names the rule, who decided, and the evidence. A comment without all three is reported as `integrity/invalid-suppression`. There is no file-wide form; use `ignore` in `ubon.json` for files Ubon should skip. [config.md](config.md#suppressing-one-finding) has the details.

## Rule IDs

Rule IDs are now names grouped in packs, for example `secret/provider-key` and `web/ssrf`. Most Ubon 3 rules have no direct successor, because 4.0 keeps only rules that are precise on real projects. [rules/README.md](rules/README.md) lists the current rules.

## Node.js and platforms

Ubon 4 needs Node.js 22.18 or newer. It runs on Linux, macOS, and Windows; see [compatibility.md](compatibility.md).
