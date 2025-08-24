# Ubon VS Code Extension (MVP)

Run Ubon in VS Code and see diagnostics in the Problems panel.

## Features
- Command: "Ubon: Scan Workspace"
- Runs on save (configurable)
- Diagnostics mapped by file/line
- Quick Fixes: add alt to <img>, aria-label to <input>, add HttpOnly; Secure to cookies, redact secrets in console logs

## Settings
- `ubon.cliPath`: Path to ubon CLI (default: `ubon`)
- `ubon.args`: CLI args (default: `["check", "--json"]`)
- `ubon.runOnSave`: Auto-run on save (default: true)

## Local Development
1. Open this folder in VS Code
2. `npm install`
3. Press F5 to launch Extension Development Host
4. Run "Ubon: Scan Workspace"

Note: Requires `ubon` installed and available on PATH.
