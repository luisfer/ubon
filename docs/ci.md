# CI

In CI, Ubon checks the pull request's changes against the merge base and fails the job when there are blocking findings. It runs independently of any agent, so it also catches what an agent's session let through.

## GitHub Actions

`npx ubon init --github --yes` writes this workflow, or add the action to your own:

```yaml
name: ubon
on:
  pull_request:
permissions:
  contents: read
jobs:
  ubon:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write # only for sarif: true
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0 # the merge base must be in the clone
          persist-credentials: false
      - uses: luisfer/ubon@<commit SHA of a release> # v4.0.0
        with:
          sarif: true
```

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | the action's own version | Ubon version to run (exact). |
| `base` | `origin/<pull request base branch>` | Ref to compare against. |
| `all` | `false` | Check every file instead of the changes. |
| `sarif` | `false` | Upload SARIF to code scanning. Needs `security-events: write`. |
| `summary` | `true` | Write the Markdown report to the job summary. |
| `online` | `false` | Allow registry and OSV lookups for new packages. |
| `fail-on` | `block` | `block` fails the step on blocking findings; `never` only reports. |
| `working-directory` | `.` | Where to run. |

Outputs: `blocking`, `warnings`, and `report` (the path of the JSON report).

The job summary lists every suppression added in the pull request in its own section, so a reviewer sees what was waved through and by whom.

Pin the action to a commit SHA, not a tag: a tag can be moved to different code.

## Other CI systems

Any CI with Node.js 22.18 or newer:

```sh
npx --yes ubon@4.0.0 check --base "origin/$BASE_BRANCH" --output ubon.sarif --output ubon.json
```

- Fetch enough history for the merge base. A shallow clone (depth 1) does not have it; Ubon then compares with the ref directly and says so in the report.
- Pin the version (`ubon@4.0.0`), so a new release cannot change what CI enforces without a pull request.
- The exit code is 1 when there are blocking findings, 2 for a configuration error, and 3 when Ubon itself failed.

GitLab CI example:

```yaml
ubon:
  image: node:24
  variables:
    GIT_DEPTH: 0
  script:
    - npx --yes ubon@4.0.0 check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --output gl-sast-report.sarif
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

## Existing projects

On a project with existing findings, run `ubon check --all` once, fix what you can, and record the rest with `ubon baseline`. Pull request checks report only what each pull request changes, so they do not need the baseline; full audits (`--all`) use it to show only new findings.

## Git hooks

`npx ubon init --git-hooks --yes` adds `ubon check --staged` to your pre-commit hook: to husky or the pre-commit framework when you use them, otherwise as `.githooks/pre-commit` (enable it with `git config core.hooksPath .githooks`). With the pre-commit framework:

```yaml
repos:
  - repo: https://github.com/luisfer/ubon
    rev: v4.0.0
    hooks:
      - id: ubon
```

`--staged` reads the content from the index, so it checks exactly what the commit records.
