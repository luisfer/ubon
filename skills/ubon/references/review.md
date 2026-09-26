# Security review

Use when the user asks for a security review, or before a release. Ubon gives you facts; you give the judgment. Keep the two apart in your report.

## 1. Collect facts

1. `ubon check --all` for every finding in the project, not only recent changes. If the project has `.ubon/baseline.json`, also run with the baseline in mind: findings in it were accepted earlier.
2. `ubon map` for every entry point: route handlers, Server Actions, form actions, loaders, API routes, and tools a model can call, with the auth calls, data access, model calls, and env variables each one uses.

## 2. Review each entry point

Work through `ubon map`'s list. For each entry point, read the handler and answer:

- Who can call it? Look for an auth call in the handler or in middleware. Ubon only sees calls in the handler and one level of local helpers.
- Does it check that the caller owns the data it reads or changes (not only that the caller is logged in)?
- Does it validate input with a schema before using it?
- If it calls a model: is there a rate limit and a token cap? Can user input reach the system prompt? Can model output reach a dangerous sink?
- If it calls another service: can the caller choose the URL or the host?

Start with the entry points `ubon map` lists as writing data or calling a model without an auth call.

## 3. Report

Use two sections:

- `Ubon findings`: the output of `ubon check --all`, grouped by rule, with your assessment of each (confirmed, false positive and why, or not assessed).
- `Review findings`: problems you found by reading the code, each with the file and line, what can go wrong, who can trigger it, and a fix.

End with what you did not review (for example, infrastructure config, third-party services, or code outside the repository). Do not claim the application is secure; say what you checked.
