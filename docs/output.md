# Output

`ubon check` writes one of five formats. The default is `text` in a terminal, `agent` inside a coding agent's shell (Ubon detects Claude Code, Codex, Gemini CLI, Copilot, and Cursor from their environment variables), and the format matching the file extension when you pass `--output`.

| Format | For | Select with |
| --- | --- | --- |
| `text` | people in a terminal | `--format text` |
| `agent` | coding agents: one line per finding, instructions at the end | `--format agent` |
| `json` | programs; versioned schema | `--format json`, or `--output report.json` |
| `sarif` | GitHub code scanning and other SARIF tools | `--format sarif`, or `--output ubon.sarif` |
| `markdown` | pull request comments and CI job summaries | `--format markdown`, or `--summary <file>` to append it |

`--output` can be given more than once; each file gets the format of its extension (`.json`, `.sarif`, `.md`). `UBON_FORMAT` in the environment sets the default format.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No blocking findings. |
| 1 | At least one blocking finding. |
| 2 | Usage or configuration error. The message names the flag or key. |
| 3 | Ubon failed. Please report it. In hooks, Ubon never fails the agent's action: it allows it and shows a notice. |

## Text

```
ubon 4.0.0: 2 changed files since origin/main (0.3 s)

block  secret/provider-key  lib/openai.ts:3
       OpenAI API key in source: sk-proj-...a1B2.
       3   sk-proj-...a1B2
       Fix: Move it to an environment variable (for example process.env.OPENAI_API_KEY) and rotate the key, because it is exposed.

1 blocking.
```

## JSON

The report has `schemaVersion: "4.0"` and follows [schema/report.json](../schema/report.json).

| Field | Meaning |
| --- | --- |
| `scope` | `mode` (`diff`, `all`, `paths`, `staged`, `session`), `base` and `baseCommit` when there is one, and `files` (how many files were checked). |
| `summary` | Counts: `block`, `warn`, `suppressed`, `baselined`. |
| `findings[]` | `rule`, `level`, `file`, `range` (1-based line and column), `message`, `evidence` (masked), `trace` (source-to-sink steps, when there are any), `fix`, `docs`, `fingerprint`, `introduced`. |
| `suppressed[]` | Findings that an `ubon-ignore` comment suppressed, with the comment's line, its reason, and `added` (whether the comment is new in this change). |
| `notChecked[]` | What Ubon could not check in this run: files over the size limit, files with syntax errors, lookups that did not run. |
| `notes[]` | Facts about the run, such as a fallback base in a shallow clone. |

`introduced` is `true` for a finding that is new in this change and `false` for one that already existed at the base (such findings are reported as warnings and never block). It is absent when there is no base, as in `--all`.

`fingerprint` is 16 hex characters derived from the rule, the file, the finding's line text (masked), and its position among identical findings. Line numbers are not part of it, so a finding keeps its fingerprint when code above it moves. Baselines and SARIF `partialFingerprints` use it.

## Secrets in output

Every string that leaves Ubon (messages, evidence, traces, SARIF, MCP results, hook output, the session log) goes through one masking function when the finding is created. A key is shown as its documented prefix and last four characters, for example `sk-proj-...a1B2`, so you can tell which key to rotate. Connection strings keep their host and lose their password. The tests check every output format against generated keys of every supported provider format.
