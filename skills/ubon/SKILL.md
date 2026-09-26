---
name: ubon
description: Check code changes, shell commands, and packages with Ubon, a deterministic checker for leaked secrets, trust-boundary bugs (SQL injection, SSRF, command injection), missing Supabase row level security, risky or nonexistent packages, agent configuration, and weakened tests. Use it after changing code and before saying a task is done, before installing a package, when code needs a key or a key leaked, when building features that store data or call a model, when asked for a security review, and when an Ubon finding (a rule ID such as web/ssrf or secret/provider-key) appears or looks wrong.
license: MIT
metadata:
  ubon-version: "4.0.0-alpha.0"
---

# Ubon

Ubon is a command-line checker. It reads the project's files and git history, not your reasoning, so it gives the same answer every time. Use it to check your work, and use your own judgment for what it does not cover.

## Run it

Use `ubon` when it is on your PATH (the Claude Code plugin puts it there), otherwise `npx ubon`. Check that it runs with `ubon --version`.

If Ubon cannot run (not installed, no network, blocked by permissions), start your reply with this line and then follow the playbook as far as you can without it:

`Ubon did not run: <reason>. Findings below are my own review, not Ubon's.`

Never present your own review as Ubon's result.

## Pick a playbook

| When | Playbook |
| --- | --- |
| You changed code and are about to say the task is done | [finish](references/finish.md) |
| You want a quick check after an edit | [check](references/check.md) |
| An Ubon finding appeared, or one looks wrong | [triage](references/triage.md) |
| You are about to install or add a package | [add-dependency](references/add-dependency.md) |
| Code needs an API key or a secret, or a secret leaked | [secrets](references/secrets.md) |
| You are creating tables, storage buckets, or access rules | [data-access](references/data-access.md) |
| You are building a feature that calls a language model | [llm-features](references/llm-features.md) |
| The user asks for a security review, or a release is near | [review](references/review.md) |
| The user asks to set up Ubon | [setup](references/setup.md) |

Read only the playbook the task needs.

## Rules for every playbook

1. Fix every `BLOCK` finding in code you wrote or changed before you say the task is done. `WARN` findings are information: fix them when the fix is small and clearly right, and mention the rest.
2. Do not edit `ubon.json`, hook settings (`.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json`, `.gemini/settings.json`, `.github/hooks/`), CI workflows, or tests to get past a finding. If one of them is wrong, say so and let the user decide.
3. A suppression is a claim that a finding is wrong or accepted. Write it only when you can back it with evidence from the code, in the form `ubon-ignore <rule>: <who decided>: <evidence>`, in a comment above the line. Write `user confirmed` as who decided only when the user did. Tell the user about every suppression you add.
4. Never print, copy, or repeat a secret value, even a masked one you reconstructed. Refer to secrets by variable name.
5. Say what you did not check. If a check was skipped, a command failed, or Ubon reported `Not checked:`, include that in your report.

## Output formats

`ubon check` prints the agent format when it runs in your shell:

```
ubon: 1 blocking, 1 warning in 3 changed files (base origin/main)
BLOCK web/ssrf app/api/preview/route.ts:12 fetch() uses a URL from the request body (line 9: url from the request body). Fix: allowlist the host before fetching.
WARN hygiene/variant-file components/Header-new.tsx New file looks like a copy of components/Header.tsx. Fix: merge the changes into the original file and delete the copy.
```

Each line has the level, the rule ID, the file and line, what is wrong, and the fix. `ubon explain <rule>` shows the rule in full, with examples. `ubon check --format json` gives the same report as JSON.

Exit codes: 0 no blocking findings, 1 blocking findings, 2 a usage or config error, 3 Ubon failed.
