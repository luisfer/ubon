---
description: Check npm packages with Ubon before installing them
argument-hint: "<package...>"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs" vet $ARGUMENTS` (or `npx ubon vet $ARGUMENTS` if that path does not exist). Report the result for each package. Do not install a package that Ubon reports as nonexistent, very new, a likely typo of a popular package, or malicious; tell the user what it reported and which package you think was meant.
