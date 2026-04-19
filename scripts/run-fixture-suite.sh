#!/usr/bin/env bash
# Scan every external buggy-* fixture under ~/Downloads/code/my-projects/test/
# and emit a rule-ID histogram for each. Use this as the manual eval harness
# when iterating on scanner rules.
set -euo pipefail

ROOT="${UBON_FIXTURES_ROOT:-$HOME/Downloads/code/my-projects/test}"
BIN="${UBON_BIN:-$PWD/dist/cli.js}"

if [[ ! -f "$BIN" ]]; then
  echo "error: ubon CLI not found at $BIN — run 'npm run build' first" >&2
  exit 2
fi
if [[ ! -d "$ROOT" ]]; then
  echo "error: fixtures root $ROOT does not exist" >&2
  exit 2
fi

shopt -s nullglob
for fixture in "$ROOT"/buggy-*/; do
  name="$(basename "$fixture")"
  echo
  echo "=== $name ==="
  rm -rf "${fixture%/}/.ubon"
  tmp="$(mktemp)"
  # ubon exits 1 whenever findings are present — we only care about the JSON.
  node "$BIN" scan \
    --skip-build --json --no-baseline --detailed \
    --directory "${fixture%/}" > "$tmp" 2>/dev/null || true
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const c = {};
    for (const i of d.issues) c[i.ruleId] = (c[i.ruleId] || 0) + 1;
    const rows = Object.entries(c).sort((a, b) => b[1] - a[1]);
    for (const [id, n] of rows) console.log(`  ${id.padEnd(12)} ${n}`);
    console.log(`  ${"total".padEnd(12)} ${d.issues.length}`);
  ' "$tmp"
  rm -f "$tmp"
done
