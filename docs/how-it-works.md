# How Ubon works

## One engine, many entry points

`ubon check`, the hooks, the GitHub Action, the pre-commit hook, and the MCP server all call the same engine with the same rules. Only the scope and the output format differ.

```
scope -> files -> contexts -> rules -> findings -> suppressions -> baseline -> levels -> report
```

## Scope

Ubon judges the change, not the whole history of the project.

| Mode | Files | Base |
| --- | --- | --- |
| `diff` (default) | Files changed since the base, staged or not, plus untracked files that git does not ignore | The merge base with the default branch (`origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`), or `--base` |
| `session` | Files changed since the agent session started | The session start record (below) |
| `staged` | What `git commit` would record, read from the index | `HEAD` |
| `all` | Every file git tracks or would add | none |
| `paths` | The files you name | none |

Outside a git repository, every file is checked and the report says so. In a shallow clone without the merge base, Ubon compares with the ref directly or with `HEAD`, and notes it.

## Sessions

When an agent session starts, the session start hook records `HEAD` and a snapshot of every file that already had uncommitted changes (as git blobs, in the object database). The record lives in `.git/ubon/sessions/`, which git never commits or pushes. At the stop hook, Ubon compares the working tree with that record, so work you had in progress before the session is not blamed on the agent, and files the agent created are included.

Without a start record (Ubon was installed mid-session, or the agent has no start event), the base is `HEAD`, and the report says so.

## Contexts

Most false positives in older scanners came from not knowing where code runs. Before rules run, each file gets:

- A language, from the extension (JavaScript and TypeScript variants, Vue, Svelte, Astro, JSON, YAML, TOML, SQL, Markdown, shell, env files, Firebase rules).
- Path contexts: test, generated, agent configuration, migration, CI, config, docs, example.
- Client or server. Files with `'use client'`, and every module they import, ship to the browser; so do Vue and Svelte components, pages in the Next.js Pages Router, and the source of single-page apps. Route handlers, Server Actions, `server-only` modules, `+server.ts` files, and the other framework conventions run on the server.

## Rules

Rules for JavaScript and TypeScript share one pass over each file's syntax tree (Babel's parser, bundled, with error recovery). A small taint tracker follows values from sources (request data, model output, tool arguments, network responses) through local variables, destructuring, templates, and a fixed list of pass-through functions to sinks (SQL, shell, `fetch`, file system, `eval`, HTML). Unknown function calls end the flow, which misses some bugs and avoids a class of false positives. Every data-flow finding shows its source and sink lines.

Other rules read text, SQL migrations, YAML workflows, JSON and TOML configuration, lockfiles, and the git diff. Project rules see every file; diff rules compare each changed file with its base version.

## Speed

Hooks run on every command and edit, so they have time budgets. `node scripts/bench.mjs` measures the built CLI, including Node.js start-up, and prints the median of several runs. On a 4-core cloud VM (Intel Xeon at 2.1 GHz, Node.js 22.22):

| Measurement | Median | Target |
| --- | --- | --- |
| Hook decision for a shell command (`PreToolUse`) | 86 ms | 150 ms |
| `ubon check` on a 10-file diff | 227 ms | 500 ms |
| `ubon check --all` on a generated Next.js project with 2,000 files | 1,440 ms | 5,000 ms |

Modules load when an event needs them: a hook for a shell command loads neither the rules nor the JavaScript and YAML parsers (a test checks this), and package lookups load only for install commands. `node scripts/bench.mjs --check` exits with 1 when a median is more than twice its target.

## Findings

Findings are masked when they are created. Ubon then applies `ubon-ignore` comments, the baseline, and the levels in `ubon.json`, and marks findings that already existed at the base: those are reported as warnings and never block.

## Why no model calls

The agent in the loop is the model. Ubon's job is the part a model is bad at or should not be trusted with alone: checking the same invariants every time, on every edit and command, in milliseconds, with an answer the agent cannot talk its way around. Judgment (is this route meant to be public?) is left to the model and the reviewer, with `ubon map` and the review playbook as input.

## Why some rules only warn

A rule blocks only when it is right almost every time on real projects. A wrong blocking finding in an agent loop turns into a wrong edit, so rules whose precision is lower, or whose finding depends on intent that code does not show, report warnings. [precision.md](precision.md) has the numbers per rule.
