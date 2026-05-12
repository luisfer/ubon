# Programmatic Use

Ubon is usable from Node, the CLI, and MCP. Agents should prefer MCP or JSON
CLI output. Build scripts should prefer the Node API when they already have a
file list or want to combine Ubon with another gate.

## Node API

```js
const { UbonScan } = require('ubon');

async function main() {
  const scanner = new UbonScan(false, true);
  const findings = await scanner.diagnose({
    directory: process.cwd(),
    fast: true,
    focusCritical: true,
    failOn: 'error',
    minConfidence: 0.8
  });

  if (findings.some((finding) => finding.type === 'error' && !finding.suppressed)) {
    process.exitCode = 1;
  }
}

main();
```

## Stable CLI Contracts

Use these forms in automation:

```bash
ubon check --json --quiet
ubon check --ndjson --quiet
ubon check --preset agent
ubon changed --since origin/main --json --quiet
ubon verify --preset ci
ubon rules list --json
```

`--json` returns the v2 finding schema. `--preset agent` adds source context,
explanations, and a small issue cap for repair loops. `--ndjson` emits one
finding per line for streaming consumers. `ubon rules list --json` returns
machine-readable rule metadata, sorted by rule id.

## MCP Contracts

Use `ubon.mcp` when an assistant needs to inspect, explain, verify, or plan
fixes without shelling out. Important tools:

- `ubon.check`: fast static scan.
- `ubon.scan`: full scan.
- `ubon.verify`: pass/fail gate with `failOn`.
- `ubon.plan-fixes`: ordered remediation plan.
- `ubon.rule-catalog`: rule metadata.
- `ubon.status`: project and harness status.

For diff-focused review, pass either `changedFiles`, `gitChangedSince`, or
`baseSha`. `baseSha` is accepted as an alias for CI systems that already expose
the merge base.
