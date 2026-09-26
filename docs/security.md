# Security of Ubon itself

Ubon reads untrusted input by design: repositories it checks, including pull requests from strangers in CI, and hook payloads that an agent under prompt injection may have shaped. This page is the threat model and what Ubon does about each threat.

| Threat | What Ubon does |
| --- | --- |
| A scanned repository makes Ubon run code | Configuration is JSON only. Ubon never imports or runs project files or scripts. Git runs with `core.fsmonitor` off and, for diffs and file reads, without external diff programs or text conversion filters (`--no-ext-diff`, `--no-textconv`, `cat-file`). Blob hashes for session snapshots use `--no-filters`. |
| Command injection through file names, refs, or payloads | Every child process gets an argument array; no shell strings. Refs are checked and passed after `--end-of-options`. |
| Secrets leak through Ubon's output | Masking when a finding is created, one code path for every output, tests with generated keys of every provider format. Hook recordings are masked before they are written. |
| Resource exhaustion | A file size limit (1 MB by default), a 10 MB limit on hook payloads and MCP messages, bounded syntax tree depth, linear-time patterns. |
| Path traversal and symbolic links | Symbolic links are not followed. MCP tool paths are resolved and must stay inside the workspace. |
| Network use | None unless you ask: `--online`, `packages.online`, or `ubon vet`. Only the npm registry (or the one your `.npmrc` names for a scope) and `api.osv.dev` are contacted, with package names only. Failures are reported as not checked, never as clean. |
| Writes to your project | Only `ubon init --yes`, `ubon baseline`, and files you name with `--output` or `--summary`. Session state goes to the git directory, or the user cache directory outside git. |
| An agent turns Ubon off | Edits to `ubon.json`, hook settings, and CI workflows ask a person first (`agent/protected-path-write`); removals of Ubon from those files are reported (`agent/guardrail-removed`); an invalid `ubon.json` makes hooks fall back to the defaults instead of turning off; CI runs independently of the agent. |
| Ubon crashes in a session | Hooks allow the action, show a notice, and exit 0 (GitHub Copilot denies a tool when its pre-tool hook exits with an error). `ubon check` in CI exits 3, which fails the job. |
| Ubon's own supply chain | No dependencies at install time; the parser and YAML libraries are bundled at pinned versions. Releases are published by CI with npm trusted publishing and provenance, staged until the maintainer approves them with 2FA. Workflow actions are pinned to commit SHAs. |

## What Ubon is not

Command checks catch mistakes and obvious attacks. They are not a sandbox: a determined or injected agent can find a command Ubon does not recognize. Use your agent's sandbox (Claude Code sandboxing, Codex sandbox modes, containers) for containment.

## Releases

1. The maintainer pushes a signed version tag.
2. `.github/workflows/release.yml` runs the full check suite on a clean checkout, with no dependency cache, and confirms the tag matches `package.json`.
3. The publish job runs in the protected `release` environment with `id-token: write` only, and stages the release on npm through trusted publishing (no token) with provenance.
4. The maintainer approves the staged release on npmjs.com with a 2FA challenge. An OIDC token cannot approve it, so a compromised workflow alone cannot publish.

npm package settings: two-factor authentication required and tokens disallowed; the trusted publisher is `luisfer/ubon`, workflow `release.yml`, environment `release`.

To verify a release: `npm view ubon@<version> dist.attestations` shows the provenance attestation, and `npm audit signatures` in a project that depends on it checks the registry signatures.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
