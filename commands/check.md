---
description: Check this session's changes with Ubon and fix blocking findings
argument-hint: "[path]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/ubon.mjs" check $ARGUMENTS`. If that path does not exist, run `npx ubon check $ARGUMENTS` instead.

Then follow the check playbook of the ubon skill: fix every BLOCK finding in code you changed, run the check again until none is left, and report what remains, including anything listed under "Not checked".
