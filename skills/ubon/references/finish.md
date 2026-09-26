# Finish a task

Use before you tell the user a task is done. The goal is a report the user can trust: what you ran, what passed, what you did not run, and what is left.

## Steps

1. Run the project's own checks, the ones a contributor would run. Look in `package.json` scripts, `Makefile`, `AGENTS.md`, or the CI workflow for the commands: usually tests, a type check, and a linter. Run them.
2. Run `ubon check`.
3. Fix every `BLOCK` finding in code you changed and every failing check you caused. Rerun both until they pass.
4. Report, in this order:
   - Commands you ran and their results, in one line each (for example `npm test: 142 passed`).
   - Ubon's result (for example `ubon check: no findings in 6 changed files`), or the findings you left and why.
   - Suppressions you added, each with its reason.
   - What you did not run or could not check, and why.
   - Anything the user needs to do (rotate a key, apply a migration, approve a package).

## Tests

- Do not edit a test to make it pass. That includes skipping it, loosening an assertion, or deleting it.
- If a test looks wrong, stop and ask the user, with the test name and what you think is wrong.
- Do not special-case test runs in production code (for example `if (process.env.NODE_ENV === 'test')`).

Ubon's `integrity` rules report skipped, deleted, and weakened tests, so these changes are visible in review even when they slip through.

## When checks fail for reasons you did not cause

Say so plainly: which check, the error, and why you believe it is unrelated (for example, it fails the same way on the base branch). Do not hide it and do not claim the task is fully verified.
