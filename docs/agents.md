# For agents

This page is for AI coding agents working in a repository that uses Ubon. It says when to run what, how to read the output, and what to do with a finding. People can read it too; it is the protocol the Ubon skill and the `AGENTS.md` block describe in short.

## When to run what

| Moment | Command |
| --- | --- |
| After you change code, and before you say a task is done | `ubon check` |
| Before you install or add a package | `ubon vet <package>` |
| When a finding is unclear or looks wrong | `ubon explain <rule>` |
| When asked for a security review | `ubon check --all`, then `ubon map` |

Use `ubon` when it is on your PATH, otherwise `npx ubon`. Inside Claude Code with the Ubon plugin, and in any agent set up with `ubon init`, hooks also run Ubon for you: before shell commands, after file edits, and before you finish.

If Ubon cannot run, say so in the first line of your reply (`Ubon did not run: <reason>.`) and do not present your own review as Ubon's result.

## Reading the output

In your shell, `ubon check` prints one line per finding:

```
ubon: 1 blocking, 1 warning in 3 changed files (base origin/main)
BLOCK web/ssrf app/api/preview/route.ts:12 fetch() uses a URL from the request body (line 9: url from the request body). Fix: allowlist the host before fetching.
WARN web/open-redirect app/auth/callback/route.ts:18 redirect() uses the next parameter from the query string. Fix: allow only paths that start with a single slash.
Not checked: registry lookups for new packages (offline; run with --online or set packages.online).
```

- `BLOCK`: fix it before you finish. The stop hook will not let you finish while one remains in code changed in the session (after two attempts it lets you stop and records the finding as unresolved for the pull request).
- `WARN`: information. Fix it when the fix is small and clearly right; otherwise mention it.
- `[already at the base]`: the finding existed before this change. It does not block you.
- `Not checked:` lists what Ubon could not check. Pass it on in your report.

The same report is available as JSON (`ubon check --format json`); the fields are described in [output.md](output.md).

Exit codes: 0 no blocking findings, 1 blocking findings, 2 usage or configuration error, 3 Ubon failed.

## What to do with a finding

1. Read the code at the line, and the lines in the trace when there is one.
2. If the finding is right, fix the code. The `Fix:` text says how; `ubon explain <rule>` has more.
3. If the finding is wrong, add a suppression on the line above, in the file's comment syntax, with a reason in the form `<who decided>: <evidence>`:

   ```ts
   // ubon-ignore web/ssrf: agent: host is checked against ALLOWED_HOSTS in lib/net.ts before this call
   const res = await fetch(url)
   ```

   Use `agent` as who decided when you decided from the code. Use the user's name or `user confirmed` only when the user told you. Tell the user about every suppression you add. A suppression without a reason suppresses nothing.
4. If you cannot tell, ask the user once, with the rule, the location, and what you need to know.

## What never to do

- Edit `ubon.json`, hook settings (`.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json`, `.gemini/settings.json`, `.github/hooks/`), or CI workflows to get past a finding. Ubon asks a person before those files change, and reports removed hooks.
- Edit, skip, or delete a test to make it pass. Ask the user when a test looks wrong.
- Rewrite code into a form Ubon does not recognize but that is just as unsafe.
- Print or repeat a secret value, even one that appeared in tool output.
- Suppress a finding with a reason you cannot back with evidence.

## Hooks, from the agent's side

| Hook | What you see |
| --- | --- |
| Session start | One line saying Ubon is active. |
| Before a shell command | Nothing, or a denial or a question to the user with the reason (for example `git commit --no-verify`, or installing a package that does not exist). |
| Before a file read | A question to the user for `.env` files and private keys. |
| Before a file write | A denial when the content contains a provider key or hidden Unicode in an agent file, with what to do instead. |
| After a file edit | The findings for that file, while you still have the context to fix them. |
| Before you finish | The blocking findings in everything changed in the session, or nothing. |
| Prompt submitted | A prompt that contains a provider key is blocked before it reaches the model; the user sees why. |
