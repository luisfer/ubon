# Set up Ubon

Use when the user asks to add Ubon to a project.

1. Install it as a dev dependency with the project's package manager: `npm install --save-dev ubon` (or `pnpm add -D ubon`, `yarn add -D ubon`, `bun add -d ubon`). Hooks then run the version pinned in the lockfile.
2. Run `npx ubon init`. It detects the agents in use and prints the files it would create or change. Nothing is written yet.
3. Show the user the planned changes and ask which agents to set up. Then run `npx ubon init --yes` with the chosen targets (`--claude`, `--codex`, `--cursor`, `--gemini`, `--copilot`, `--git-hooks`, `--github`).
4. For an existing project, run `npx ubon check --all`. If there are many findings, suggest `npx ubon baseline` so that checks report only new problems, and list the most serious existing findings for the user to fix later.
5. Run `npx ubon doctor` and fix what it reports.
6. Tell the user what was set up, what each hook does, and that `ubon.json` holds the settings (rule levels, ignored paths, the package policy). Do not change rule levels on your own.
