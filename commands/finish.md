---
description: Run the project's checks and Ubon, then report what was run and what is left
---

Follow the finish playbook of the ubon skill. Run the project's own tests, type check, and linter, then `node "${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs" check` (or `npx ubon check` if that path does not exist). Fix what you caused, do not edit tests to make them pass, and report the commands you ran with their results, the suppressions you added, and what you did not check.
