# Check a change

Use after an edit, when you want to know whether what you just wrote has a problem Ubon can see.

1. Run `ubon check`. It checks what changed since the base: the session start inside an agent session with Ubon hooks, otherwise the merge base with the default branch. New untracked files are included.
2. Read each line. `BLOCK` findings must be fixed before you finish. `WARN` findings are information.
3. Fix the code, not the check. The `Fix:` part of each line says what to change. For details, run `ubon explain <rule>`.
4. Run `ubon check` again until no `BLOCK` finding is left in code you changed.
5. If a finding looks wrong, follow [triage](triage.md) instead of changing code to silence it.

To check one file or folder: `ubon check src/app/api`. To check everything, not only changes: `ubon check --all`.

A finding marked `[already at the base]` existed before this change. It does not block you. Mention it to the user if it matters for the task.
