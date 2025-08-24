# Release Policy

Ubon follows Semantic Versioning. Our guiding principle: releases are incremental and non-disruptive. Upgrading within the same major version should be safe by default.

- Stability guarantees
  - Patch (x.y.z) and minor (x.Y.z) releases are backward compatible
  - Breaking changes only happen in a new major (X.y.z) with clear upgrade notes
- Rules and signal
  - New rules default to warning or are opt-in; they will not fail builds unless you set --fail-on
  - Stricter behavior ships behind profiles or confidence thresholds; defaults avoid noisy regressions
- CLI and config
  - No flag removals or renames in patch or minor; we deprecate first and remove in the next major
  - Config schema is additive within a major; we do not repurpose keys
- Outputs
  - JSON and SARIF schemas are stable within a major; additions are backward compatible
  - Sensitive values remain redacted; fingerprints stay stable for baselines
- Defaults
  - --fail-on is opt-in; defaults prioritize guidance over disruption

If you hit a regression after an upgrade, please open an issue with the version, command, and output.
