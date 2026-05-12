# Validation Harness

Ubon validates itself on three surfaces: the Ubon repository, deliberately
faulty fixtures, and machine-readable contracts used by agents and CI.

## Current Gates

```bash
npm run validate:harness
npm run dogfood
npm run verify:release
```

- `validate:harness` runs the fixture benchmark and agent/CI contract tests.
- `dogfood` scans the Ubon repository with `--focus-critical --fail-on error`.
- `verify:release` runs lint, build, rule docs sync, Jest, dogfood, and package
  dry-run verification.

Release expectation: dogfood has 0 unsuppressed critical findings.

## Faulty Fixtures

The fixture benchmark lives in `examples/validation-fixtures/manifest.json`.
Each fixture declares the expected rule id, file, severity, type, and minimum
confidence. Tests assert the finding has:

- file and line location
- range metadata
- redacted match text
- confidence reason
- fix text
- optional fix edits when a finding is auto-fixable

The fixtures currently cover:

- AI route and Cursor hook mistakes
- Next Server Action without auth and validation
- streaming LLM endpoint without auth/rate limit/bounds
- MCP config secret and broad agent autonomy
- hallucinated package import
- dangerous reusable agent command

## Contract Tests

The validation suite checks:

- `ubon check --preset agent` emits JSON with source context
- `ubon check --ndjson` is line-parseable
- `ubon review` emits PR Markdown
- `ubon rules list --json` is deterministic
- SARIF output is valid enough for GitHub code scanning ingestion
- MCP handlers expose `ubon.check`, `ubon.verify`, `ubon.plan-fixes`,
  `ubon.rule-catalog`, and `ubon.status`

## Repair Loop

Normal CI does not call a live LLM. The deterministic repair loop copies a
fixture to a temp directory, applies Ubon fix edits, rescans, and verifies the
target finding disappeared. Manual findings are validated through
`ubon.plan-fixes`, which must return file-specific fix steps.

## Optional Live Agent Eval

`npm run eval:agent` is opt-in. It does nothing unless
`UBON_AGENT_EVAL_COMMAND` is set. The command receives:

- `UBON_AGENT_EVAL_FIXTURE`: temp fixture path
- `UBON_AGENT_EVAL_REPORT`: Ubon JSON report path

The script rescans after the command exits and reports remaining findings. Keep
this out of `prepublishOnly`; use it as an occasional quality check.
