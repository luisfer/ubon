# Triage a finding

Use when an Ubon finding appears and you are not sure it is right, or you believe it is wrong.

## 1. Understand it

Run `ubon explain <rule>`. It prints what the rule catches, why, the fix, and flagged and safe examples. Read the code at the reported line and the lines in the trace.

## 2. Decide

Ask whether the problem the rule describes can actually happen in this code:

- Can the source reach the sink? Follow the trace. A value that is validated, cast, or checked against an allowlist before it reaches the sink may be safe.
- Is the context what the rule assumes? A test fixture, generated file, or example may not ship.
- Is the value a real secret? A documented public key (Supabase anon key, Stripe publishable key, Firebase web config) is not.

## 3. Act on the answer

- The finding is right: fix the code. This is the common case.
- The finding is wrong and the code is safe: add the narrowest suppression, on the line above the finding, in the file's comment syntax:

  ```ts
  // ubon-ignore web/ssrf: agent: host is checked against ALLOWED_HOSTS in lib/net.ts before this call
  const res = await fetch(url)
  ```

  The reason has two parts separated by a colon: who decided, and the evidence. Use `agent` when you decided from the code. Use the user's name or `user confirmed` only when the user told you. A suppression without a reason does not suppress anything and is reported.
- You cannot tell: ask the user once, with the rule, the location, and what you would need to know.

## 4. Report it

List every suppression you added in your final report, with its reason. Suppressions are also listed in CI summaries, so a reviewer will see them either way.

## Never

- Rewrite code into a form the rule does not recognize but that is just as unsafe (for example, moving a value through an extra variable to break the trace).
- Turn a rule off in `ubon.json` or remove Ubon's hooks. Those are the user's decisions.
